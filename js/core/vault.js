// La bóveda: todo lo que la víctima registra queda cifrado con su contraseña
// y guardado solo en su teléfono. Nada se envía a ningún servidor.

import {
  deriveKey, newSalt, encryptJson, decryptJson, encryptBytes, decryptBytes, sha256Hex, KDF_ITERATIONS,
} from './crypto.js';
import { createEntry, appendEntry, verifyChain, newId } from './model.js';
import { readExif } from './exif.js';

export const MIN_PASSWORD = 6;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const FORMAT = 'escudo-pe/boveda';
const VERSION = 1;

// Parámetros aceptables al abrir una bóveda o una copia (evita archivos
// manipulados que cuelguen el teléfono o debiliten el cifrado).
function checkMeta(meta) {
  const ok = meta && meta.format === FORMAT && typeof meta.salt === 'string'
    && Number.isInteger(meta.iterations) && meta.iterations >= 1000 && meta.iterations <= 5000000;
  if (!ok) throw new Error('Los datos de la bitácora no son válidos.');
}

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
    await storage.setMany({ meta, log: await encryptJson(key, []) });
    return new Vault(storage, key, meta, []);
  }

  static async open(storage, password) {
    const meta = await storage.get('meta');
    if (!meta) throw new Error('No hay ninguna bitácora creada.');
    checkMeta(meta);
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
    const added = await this.addMany([{ input, files }], now);
    return added[0];
  }

  /** Agrega varios registros en una sola escritura (todo o nada). */
  async addMany(items, now = new Date()) {
    let log = this.log;
    const writes = {};
    for (const { input, files = [] } of items) {
      const adjuntos = [];
      for (const f of files) {
        if (f.bytes.length > MAX_FILE_BYTES) {
          throw new Error(`"${f.nombre}" pesa más de ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
        }
        const a = { id: newId(), nombre: f.nombre, tipo: f.tipo || 'application/octet-stream', tamano: f.bytes.length, sha256: await sha256Hex(f.bytes) };
        // GPS, equipo y fecha de las fotos: quedan dentro de la cadena de huellas.
        const metadatos = readExif(f.bytes);
        if (metadatos) a.metadatos = metadatos;
        if (f.recibida) a.recibida = true;
        writes['file:' + a.id] = await encryptBytes(this.key, f.bytes);
        adjuntos.push(a);
      }
      log = await appendEntry(log, createEntry({ ...input, adjuntos }, now));
    }
    writes.log = await encryptJson(this.key, log);
    await this.storage.setMany(writes);
    const added = log.slice(this.log.length);
    this.log = log;
    return added;
  }

  /** Plan de seguridad y palabra clave familiar (cifrados, fuera de la bitácora encadenada). */
  async getPlan() {
    const box = await this.storage.get('plan');
    return box ? decryptJson(this.key, box) : { hechos: {}, palabraClave: '', notas: '' };
  }

  async savePlan(plan) {
    await this.storage.set('plan', await encryptJson(this.key, plan));
  }

  /** Deja constancia de un evento de custodia en la bitácora encadenada. */
  async logCustody(evento, descripcion = '', dispositivo = globalThis.navigator?.userAgent || '') {
    return this.add({ tipo: 'custodia', evento, descripcion, dispositivo });
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
      if (key === 'log' || key === 'plan' || key.startsWith('file:')) items[key] = await this.storage.get(key);
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
    checkMeta(data.meta);
    const key = await deriveKey(password, data.meta.salt, data.meta.iterations);
    const log = await decryptJson(key, data.items.log);
    const items = {};
    for (const [k, v] of Object.entries(data.items)) {
      if (k === 'log' || k === 'plan' || /^file:[0-9a-f]{16}$/.test(k)) items[k] = v;
    }
    await storage.setMany({ ...items, meta: data.meta }, { replace: true });
    return new Vault(storage, key, data.meta, log);
  }

  /** Vuelve a cifrar todo con la nueva contraseña y lo guarda en una sola escritura. */
  async changePassword(newPassword) {
    checkPassword(newPassword);
    const meta = { ...this.meta, salt: newSalt() };
    const key = await deriveKey(newPassword, meta.salt, meta.iterations);
    const entries = { meta, log: await encryptJson(key, this.log) };
    const plan = await this.storage.get('plan');
    if (plan) entries.plan = await encryptJson(key, await decryptJson(this.key, plan));
    for (const k of await this.storage.keys()) {
      if (k.startsWith('file:')) entries[k] = await encryptBytes(key, await decryptBytes(this.key, await this.storage.get(k)));
    }
    await this.storage.setMany(entries);
    this.key = key;
    this.meta = meta;
  }
}
