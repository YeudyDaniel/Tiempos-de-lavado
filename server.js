const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = '1234'; // Cambia este PIN por uno tuyo. Solo quien lo sepa puede agregar/editar/borrar equipos.
const DATA_FILE = path.join(__dirname, 'equipos.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sendJSON(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  });
  res.end(JSON.stringify(obj));
}

function isAdmin(req) {
  return req.headers['x-admin-pin'] === ADMIN_PIN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
  });
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Prohibido'); return; }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('No encontrado'); return; }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pin',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    });
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  if (urlPath === '/api/admin-check' && req.method === 'GET') {
    sendJSON(res, isAdmin(req) ? 200 : 403, { ok: isAdmin(req) });
    return;
  }

  if (urlPath === '/api/equipos' && req.method === 'GET') {
    sendJSON(res, 200, readData());
    return;
  }

  if (urlPath === '/api/config' && req.method === 'GET') {
    sendJSON(res, 200, readConfig());
    return;
  }

  if (urlPath === '/api/config' && req.method === 'PUT') {
    if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
    try {
      const input = await readBody(req);
      writeConfig(input);
      sendJSON(res, 200, input);
    } catch (e) { sendJSON(res, 400, { error: 'Datos inválidos' }); }
    return;
  }

  if (urlPath === '/api/equipos' && req.method === 'POST') {
    if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
    try {
      const input = await readBody(req);
      if (!input.name || !input.intervalHours || input.intervalHours <= 0) {
        sendJSON(res, 400, { error: 'Nombre e intervalo son requeridos' }); return;
      }
      const data = readData();
      const eq = {
        id: 'eq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        name: String(input.name).slice(0, 80),
        intervalHours: Number(input.intervalHours),
        lastWashed: Date.now()
      };
      data.push(eq);
      writeData(data);
      sendJSON(res, 200, eq);
    } catch (e) { sendJSON(res, 400, { error: 'Datos inválidos' }); }
    return;
  }

  const idMatch = urlPath.match(/^\/api\/equipos\/([a-zA-Z0-9_]+)$/);
  if (idMatch && req.method === 'PUT') {
    if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
    try {
      const input = await readBody(req);
      const data = readData();
      const eq = data.find(e => e.id === idMatch[1]);
      if (!eq) { sendJSON(res, 404, { error: 'Equipo no encontrado' }); return; }
      if (input.name) eq.name = String(input.name).slice(0, 80);
      if (input.intervalHours) eq.intervalHours = Number(input.intervalHours);
      writeData(data);
      sendJSON(res, 200, eq);
    } catch (e) { sendJSON(res, 400, { error: 'Datos inválidos' }); }
    return;
  }

  if (idMatch && req.method === 'DELETE') {
    if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
    const data = readData().filter(e => e.id !== idMatch[1]);
    writeData(data);
    sendJSON(res, 200, { ok: true });
    return;
  }

  const washMatch = urlPath.match(/^\/api\/equipos\/([a-zA-Z0-9_]+)\/lavar$/);
  if (washMatch && req.method === 'POST') {
    const data = readData();
    const eq = data.find(e => e.id === washMatch[1]);
    if (!eq) { sendJSON(res, 404, { error: 'Equipo no encontrado' }); return; }
    eq.lastWashed = Date.now();
    writeData(data);
    sendJSON(res, 200, eq);
    return;
  }

  serveStatic(req, res);
});

if (!fs.existsSync(DATA_FILE)) writeData([]);
if (!fs.existsSync(CONFIG_FILE)) writeConfig({});

server.listen(PORT, () => {
  console.log('');
  console.log('=================================================');
  console.log('  Servidor de Control de Lavado activo');
  console.log('=================================================');
  console.log('  En esta PC, abre:      http://localhost:' + PORT);
  console.log('  Otros en la misma WiFi entran usando la IP de esta PC.');
  console.log('  PIN de administrador (editable en server.js): ' + ADMIN_PIN);
  console.log('  Deja esta ventana abierta mientras uses la app.');
  console.log('=================================================');
  console.log('');
});
