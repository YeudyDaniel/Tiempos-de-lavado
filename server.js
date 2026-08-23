const http = require('http');
const fs = require('fs');
const path = require('path');
const storage = require('./storage');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = '1234'; // Pin de administrador
const DATA_FILE = path.join(__dirname, 'equipos.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CATEGORIES_FILE = path.join(__dirname, 'categorias.json');
const HISTORY_FILE = path.join(__dirname, 'historial.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_HISTORY = 3000;

// ---- Envoltorios sobre la capa de almacenamiento (Mongo o archivo local, segun configuracion) ----

async function readData() { return storage.readArray('equipos', DATA_FILE); }
async function writeData(data) { return storage.writeArray('equipos', data, DATA_FILE); }

async function readCategories() { return storage.readArray('categorias', CATEGORIES_FILE); }
async function writeCategories(cats) { return storage.writeArray('categorias', cats, CATEGORIES_FILE); }

async function readConfig() { return storage.readObject('config', CONFIG_FILE); }
async function writeConfig(cfg) { return storage.writeObject('config', cfg, CONFIG_FILE); }

async function readHistory() { return storage.readArray('historial', HISTORY_FILE); }
async function writeHistory(hist) { return storage.writeArray('historial', hist, HISTORY_FILE); }

async function addHistoryEntry(entry) {
  const hist = await readHistory();
  hist.push(entry);
  while (hist.length > MAX_HISTORY) hist.shift();
  await writeHistory(hist);
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

  try {
    if (urlPath === '/api/admin-check' && req.method === 'GET') {
      sendJSON(res, isAdmin(req) ? 200 : 403, { ok: isAdmin(req) });
      return;
    }

    if (urlPath === '/api/equipos' && req.method === 'GET') {
      sendJSON(res, 200, await readData());
      return;
    }

    if (urlPath === '/api/equipos/restaurar' && req.method === 'POST') {
      if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
      try {
        const input = await readBody(req);
        if (!Array.isArray(input)) { sendJSON(res, 400, { error: 'El archivo no tiene el formato esperado (debe ser una lista de equipos)' }); return; }
        const cleaned = input.map(item => ({
          id: item.id && typeof item.id === 'string' ? item.id : ('eq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
          name: String(item.name || 'Equipo sin nombre').slice(0, 80),
          intervalHours: Number(item.intervalHours) > 0 ? Number(item.intervalHours) : 24,
          categoryId: item.categoryId ? String(item.categoryId) : '',
          lastWashed: Number(item.lastWashed) || Date.now(),
          lastWashedBy: item.lastWashedBy ? String(item.lastWashedBy).slice(0, 60) : undefined
        }));
        await writeData(cleaned);
        sendJSON(res, 200, { ok: true, restored: cleaned.length });
      } catch (e) { sendJSON(res, 400, { error: 'No se pudo leer el archivo de respaldo' }); }
      return;
    }

    if (urlPath === '/api/config' && req.method === 'GET') {
      sendJSON(res, 200, await readConfig());
      return;
    }

    if (urlPath === '/api/config' && req.method === 'PUT') {
      if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
      try {
        const input = await readBody(req);
        await writeConfig(input);
        sendJSON(res, 200, input);
      } catch (e) { sendJSON(res, 400, { error: 'Datos inválidos' }); }
      return;
    }

    if (urlPath === '/api/categorias' && req.method === 'GET') {
      sendJSON(res, 200, await readCategories());
      return;
    }

    if (urlPath === '/api/historial' && req.method === 'GET') {
      const hist = (await readHistory()).slice().reverse();
      sendJSON(res, 200, hist);
      return;
    }

    if (urlPath === '/api/categorias' && req.method === 'POST') {
      if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
      try {
        const input = await readBody(req);
        if (!input.name || !String(input.name).trim()) { sendJSON(res, 400, { error: 'Nombre requerido' }); return; }
        const cats = await readCategories();
        const cat = {
          id: 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          name: String(input.name).trim().slice(0, 40)
        };
        cats.push(cat);
        await writeCategories(cats);
        sendJSON(res, 200, cat);
      } catch (e) { sendJSON(res, 400, { error: 'Datos inválidos' }); }
      return;
    }

    const catIdMatch = urlPath.match(/^\/api\/categorias\/([a-zA-Z0-9_]+)$/);
    if (catIdMatch && req.method === 'PUT') {
      if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
      try {
        const input = await readBody(req);
        const cats = await readCategories();
        const cat = cats.find(c => c.id === catIdMatch[1]);
        if (!cat) { sendJSON(res, 404, { error: 'Categoría no encontrada' }); return; }
        if (input.name && String(input.name).trim()) cat.name = String(input.name).trim().slice(0, 40);
        await writeCategories(cats);
        sendJSON(res, 200, cat);
      } catch (e) { sendJSON(res, 400, { error: 'Datos inválidos' }); }
      return;
    }

    if (catIdMatch && req.method === 'DELETE') {
      if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
      const cats = (await readCategories()).filter(c => c.id !== catIdMatch[1]);
      await writeCategories(cats);
      const data = await readData();
      let changed = false;
      data.forEach(eq => { if (eq.categoryId === catIdMatch[1]) { eq.categoryId = ''; changed = true; } });
      if (changed) await writeData(data);
      sendJSON(res, 200, { ok: true });
      return;
    }

    if (urlPath === '/api/equipos' && req.method === 'POST') {
      if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
      try {
        const input = await readBody(req);
        if (!input.name || !input.intervalHours || input.intervalHours <= 0) {
          sendJSON(res, 400, { error: 'Nombre e intervalo son requeridos' }); return;
        }
        const data = await readData();
        const eq = {
          id: 'eq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
          name: String(input.name).slice(0, 80),
          intervalHours: Number(input.intervalHours),
          categoryId: input.categoryId ? String(input.categoryId) : '',
          lastWashed: Date.now()
        };
        data.push(eq);
        await writeData(data);
        sendJSON(res, 200, eq);
      } catch (e) { sendJSON(res, 400, { error: 'Datos inválidos' }); }
      return;
    }

    const idMatch = urlPath.match(/^\/api\/equipos\/([a-zA-Z0-9_]+)$/);
    if (idMatch && req.method === 'PUT') {
      if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
      try {
        const input = await readBody(req);
        const data = await readData();
        const eq = data.find(e => e.id === idMatch[1]);
        if (!eq) { sendJSON(res, 404, { error: 'Equipo no encontrado' }); return; }
        if (input.name) eq.name = String(input.name).slice(0, 80);
        if (input.intervalHours) eq.intervalHours = Number(input.intervalHours);
        if (input.categoryId !== undefined) eq.categoryId = String(input.categoryId);
        await writeData(data);
        sendJSON(res, 200, eq);
      } catch (e) { sendJSON(res, 400, { error: 'Datos inválidos' }); }
      return;
    }

    if (idMatch && req.method === 'DELETE') {
      if (!isAdmin(req)) { sendJSON(res, 403, { error: 'PIN de administrador incorrecto' }); return; }
      const data = (await readData()).filter(e => e.id !== idMatch[1]);
      await writeData(data);
      sendJSON(res, 200, { ok: true });
      return;
    }

    const washMatch = urlPath.match(/^\/api\/equipos\/([a-zA-Z0-9_]+)\/lavar$/);
    if (washMatch && req.method === 'POST') {
      let name = '';
      try {
        const input = await readBody(req);
        if (input && input.name) name = String(input.name).slice(0, 60);
      } catch (e) { /* body may be empty; proceed without a name */ }
      const data = await readData();
      const eq = data.find(e => e.id === washMatch[1]);
      if (!eq) { sendJSON(res, 404, { error: 'Equipo no encontrado' }); return; }
      eq.lastWashed = Date.now();
      if (name) eq.lastWashedBy = name;
      await writeData(data);
      await addHistoryEntry({
        id: 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        equipoId: eq.id,
        equipoName: eq.name,
        timestamp: eq.lastWashed,
        washedBy: name || '',
        extra: false
      });
      sendJSON(res, 200, eq);
      return;
    }

    const washExtraMatch = urlPath.match(/^\/api\/equipos\/([a-zA-Z0-9_]+)\/lavar-extra$/);
    if (washExtraMatch && req.method === 'POST') {
      let name = '';
      try {
        const input = await readBody(req);
        if (input && input.name) name = String(input.name).slice(0, 60);
      } catch (e) { /* body may be empty; proceed without a name */ }
      const data = await readData();
      const eq = data.find(e => e.id === washExtraMatch[1]);
      if (!eq) { sendJSON(res, 404, { error: 'Equipo no encontrado' }); return; }
      // Deliberadamente NO toca eq.lastWashed / eq.lastWashedBy - esto es un registro
      // de un lavado intermedio no oficial; el conteo del proximo lavado oficial no cambia.
      await addHistoryEntry({
        id: 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        equipoId: eq.id,
        equipoName: eq.name,
        timestamp: Date.now(),
        washedBy: name || '',
        extra: true
      });
      sendJSON(res, 200, { ok: true });
      return;
    }

    serveStatic(req, res);
  } catch (err) {
    console.error('Error en la solicitud:', err);
    sendJSON(res, 500, { error: 'Error interno del servidor' });
  }
});

async function ensureSeedFiles() {
  if (storage.USE_MONGO) return; // Mongo no necesita archivos semilla
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
  if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, '{}');
  if (!fs.existsSync(CATEGORIES_FILE)) fs.writeFileSync(CATEGORIES_FILE, '[]');
  if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]');
}

ensureSeedFiles();

server.listen(PORT, () => {
  console.log('');
  console.log('=================================================');
  console.log('  Servidor de Control de Lavado activo');
  console.log('=================================================');
  console.log('  Almacenamiento:', storage.USE_MONGO ? 'MongoDB Atlas (persistente)' : 'Archivos locales (equipos.json, etc.)');
  console.log('  En esta PC, abre:      http://localhost:' + PORT);
  console.log('  Otros en la misma WiFi entran usando la IP de esta PC.');
  console.log('  PIN de administrador (editable en server.js): ' + ADMIN_PIN);
  console.log('  Deja esta ventana abierta mientras uses la app.');
  console.log('=================================================');
  console.log('');
});
