// Almacenamiento clave-valor. La bóveda solo guarda aquí datos ya cifrados,
// salvo "meta" (sal y parámetros, que no son secretos).
//
// Interfaz: get(key), set(key, value), del(key), keys(), clear().

export class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    const v = this.map.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }
  async set(key, value) {
    this.map.set(key, structuredClone(value));
  }
  async del(key) {
    this.map.delete(key);
  }
  async keys() {
    return [...this.map.keys()];
  }
  async clear() {
    this.map.clear();
  }
}

/** Almacenamiento del navegador. IndexedDB aguanta archivos grandes (fotos, audios). */
export class IndexedDBStorage {
  constructor(dbName = 'escudo', storeName = 'boveda') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbPromise = null;
  }

  db() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(this.storeName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  async run(mode, fn) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const req = fn(tx.objectStore(this.storeName));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  get(key) { return this.run('readonly', (s) => s.get(key)); }
  set(key, value) { return this.run('readwrite', (s) => s.put(value, key)); }
  del(key) { return this.run('readwrite', (s) => s.delete(key)); }
  keys() { return this.run('readonly', (s) => s.getAllKeys()); }
  clear() { return this.run('readwrite', (s) => s.clear()); }
}
