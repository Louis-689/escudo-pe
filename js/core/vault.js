// La bóveda: todo lo que la víctima registra queda cifrado con su contraseña
// y guardado solo en su teléfono. Nada se envía a ningún servidor.

import {
  deriveKey, newSalt, encryptJson, decryptJson, encryptBytes, decryptBytes, sha256Hex, KDF_ITERATIONS,
} from './crypto.js';
import { createEntry, appendEntry, verifyChain, newId } from './model.js';

export const MIN_PASSWORD = 6;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const FORMAT = 'escudo-pe/boveda';
const VERSION = 1;

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }
}

export class Vault {
  constructor(storage, key, meta, log) {
    this.storage = storage;
    this.key = key;
    this.meta = meta;
    this.log = log;
  }

  static async exists(storage) {
    return Boolean(await storage.get('meta'));
  }

  static async create(storage, password, { iterations = KDF_ITERATIONS } = {}) {
    checkPassword(password);
    if (await Vault.exists(storage)) throw new Error('Ya existe una bitácora en este teléfono.');
    const meta = { format: FORMAT, version: VERSION, salt: newSalt(), iterations, creadoEn: new Date().toISOString() };
    const key = await deriveKey(password, meta.salt, iterations);
    const vault = new Vault(storage, key, meta, []);
    await storage.set('meta', meta);
    await vault.saveLog();
    return vault;
  }

  static async open(storage, password) {
    const meta = await storage.get('meta');
    if (!meta) throw new Error('No hay ninguna bitácora creada.');
    const key = await deriveKey(password, meta.salt, meta.iterations);
    const log = await decryptJson(key, await storage.get('log'));
    return new Vault(storage, key, meta, log);
  }

  /** Borra todo de forma irreversible. */
  static async wipe(storage) {
    await storage.clear();
  }

  async saveLog() {
    await this.storage.set('log', await encryptJson(this.key, this.log));
  }

  /**
   * Agrega un incidente o una nota.
   * files: [{ nombre, tipo, bytes: Uint8Array }]. La huella SHA-256 se calcula
   * sobre los bytes originales antes de cifrarlos.
   */
  async add(input, files = [], now = new Date()) {
    const adjuntos = [];
    for (const f of files) {
      if (f.bytes.length > MAX_FILE_BYTES) {
        throw new Error(`"${f.nombre}" pesa más de ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
      }
      adjuntos.push({ id: newId(), nombre: f.nombre, tipo: f.tipo || 'application/octet-stream', tamano: f.bytes.length, sha256: await sha256Hex(f.bytes), bytes: f.bytes });
    }
    const entry = createEntry({ ...input, adjuntos }, now);
    for (const a of adjuntos) {
      await this.storage.set('file:' + a.id, await encryptBytes(this.key, a.bytes));
    }
    this.log = await appendEntry(this.log, entry);
    await this.saveLog();
    return this.log[this.log.length - 1];
  }

  async readFile(id) {
    const box = await this.storage.get('file:' + id);
    if (!box) throw new Error('No se encontró el archivo.');
    return decryptBytes(this.key, box);
  }

  /** Revisa la cadena de registros y que cada archivo coincida con su huella. */
  async verify() {
    const chain = await verifyChain(this.log);
    const archivosAlterados = [];
    for (const entry of this.log) {
      for (const a of entry.adjuntos || []) {
        try {
          const bytes = await this.readFile(a.id);
          if ((await sha256Hex(bytes)) !== a.sha256) archivosAlterados.push(a.nombre);
        } catch {
          archivosAlterados.push(a.nombre);
        }
      }
    }
    return { ...chain, archivosAlterados, ok: chain.ok && archivosAlterados.length === 0 };
  }

  /** Copia de seguridad (sigue cifrada: sin la contraseña no sirve de nada). */
  async exportBackup() {
    const items = {};
    for (const key of await this.storage.keys()) {
      if (key === 'log' || key.startsWith('file:')) items[key] = await this.storage.get(key);
    }
    return JSON.stringify({ format: FORMAT + '/copia', version: VERSION, meta: this.meta, items });
  }

  /** Restaura una copia en un teléfono. Comprueba la contraseña antes de escribir nada. */
  static async importBackup(storage, text, password) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('El archivo no es una copia de Escudo.');
    }
    if (!data || data.format !== FORMAT + '/copia' || !data.meta || !data.items || !data.items.log) {
      throw new Error('El archivo no es una copia de Escudo.');
    }
    const key = await deriveKey(password, data.meta.salt, data.meta.iterations);
    const log = await decryptJson(key, data.items.log);
    await storage.clear();
    await storage.set('meta', data.meta);
    for (const [k, v] of Object.entries(data.items)) await storage.set(k, v);
    return new Vault(storage, key, data.meta, log);
  }

  async changePassword(newPassword) {
    checkPassword(newPassword);
    const meta = { ...this.meta, salt: newSalt() };
    const key = await deriveKey(newPassword, meta.salt, meta.iterations);
    const files = {};
    for (const k of await this.storage.keys()) {
      if (k.startsWith('file:')) files[k] = await decryptBytes(this.key, await this.storage.get(k));
    }
    for (const [k, bytes] of Object.entries(files)) await this.storage.set(k, await encryptBytes(key, bytes));
    this.key = key;
    this.meta = meta;
    await this.saveLog();
    await this.storage.set('meta', meta);
  }
}
