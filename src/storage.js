// Lokale Spielstände in IndexedDB. Jeder Zugriff ist abgesichert: Ohne IndexedDB (privates Fenster,
// blockierter Speicher) läuft das Spiel weiter – Spielstände leben dann nur bis zum Neuladen.
const DB_NAME = 'teleferico';
const DB_VERSION = 1;
const STORE = 'saves';

let dbPromise = null;
const memory = new Map(); // Ersatzspeicher ohne IndexedDB

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) {
          resolve(fn(null));
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const store = tx.objectStore(STORE);
          const req = fn(store);
          let result;
          if (req && 'onsuccess' in req) req.onsuccess = () => (result = req.result);
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const localSaves = {
  /** Steht dauerhafter Speicher zur Verfügung? */
  async available() {
    return !!(await openDb());
  },

  /** Alle Einträge ohne Spieldaten: [{ id, meta, updatedAt }] */
  async list() {
    const all = await run('readonly', (store) => (store ? store.getAll() : null));
    const rows = all === undefined || all === null ? [...memory.values()] : all;
    return rows.map(({ id, meta, updatedAt }) => ({ id, meta, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async get(id) {
    const row = await run('readonly', (store) => (store ? store.get(id) : null));
    if (row === null || row === undefined) return memory.get(id) || null;
    return row;
  },

  async put(id, meta, data) {
    const row = { id, meta, data, updatedAt: Date.now() };
    memory.set(id, row);
    const ok = await run('readwrite', (store) => (store ? store.put(row) : null));
    return ok !== undefined;
  },

  async remove(id) {
    memory.delete(id);
    await run('readwrite', (store) => (store ? store.delete(id) : null));
    return true;
  },
};
