// Capa de almacenamiento: usa MongoDB Atlas si existe la variable de entorno
// MONGODB_URI (Sobrevive a los apagones.
// Si no existe esa variable, usa archivos locales .json (modo servidor local en la PC).

const fs = require('fs');
const path = require('path');

const USE_MONGO = !!process.env.MONGODB_URI;
let MongoClient = null;
if (USE_MONGO) {
  MongoClient = require('mongodb').MongoClient;
}

let client = null;
let dbPromise = null;

function getDb() {
  if (!USE_MONGO) return null;
  if (!dbPromise) {
    client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      retryWrites: true
    });
    dbPromise = client.connect()
      .then(() => client.db('control_lavado'))
      .catch((err) => {
        dbPromise = null; // permite reintentar en la próxima solicitud en vez de quedar atascado
        throw err;
      });
  }
  return dbPromise;
}

// ---- Colecciones tipo "lista completa" (equipos, categorias) ----
// Mantienen la misma semántica que antes: leer todo el arreglo, o reemplazarlo entero.

async function readArray(collectionName, fallbackFile) {
  if (USE_MONGO) {
    const db = await getDb();
    const docs = await db.collection(collectionName).find({}).toArray();
    return docs.map(d => { const { _id, ...rest } = d; return rest; });
  }
  try {
    return JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
  } catch (e) {
    return [];
  }
}

async function writeArray(collectionName, data, fallbackFile) {
  if (USE_MONGO) {
    const db = await getDb();
    const col = db.collection(collectionName);
    await col.deleteMany({});
    if (data.length > 0) await col.insertMany(data.map(d => ({ ...d })));
    return;
  }
  fs.writeFileSync(fallbackFile, JSON.stringify(data, null, 2));
}

// ---- Config (un solo documento/objeto) ----

async function readObject(collectionName, fallbackFile) {
  if (USE_MONGO) {
    const db = await getDb();
    const doc = await db.collection(collectionName).findOne({ _key: 'singleton' });
    if (!doc) return {};
    const { _id, _key, ...rest } = doc;
    return rest;
  }
  try {
    return JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function writeObject(collectionName, obj, fallbackFile) {
  if (USE_MONGO) {
    const db = await getDb();
    await db.collection(collectionName).updateOne(
      { _key: 'singleton' },
      { $set: { ...obj, _key: 'singleton' } },
      { upsert: true }
    );
    return;
  }
  fs.writeFileSync(fallbackFile, JSON.stringify(obj, null, 2));
}

module.exports = { USE_MONGO, readArray, writeArray, readObject, writeObject, getDb };
