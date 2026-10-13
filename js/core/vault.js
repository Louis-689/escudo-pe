// La bóveda: todo lo que la víctima registra queda cifrado con su contraseña
// y guardado solo en su teléfono. Nada se envía a ningún servidor.

import {
  deriveKey, newSalt, encryptJson, decryptJson, encryptBytes, decryptBytes, sha256Hex, KDF_ITERATIONS,
} from './crypto.js';
import { createEntry, appendEntry, verifyChain, newId } from './model.js';
import { readExif } from './exif.js';

export const MIN_PASSWORD = 8;
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

const PASSWORD_HINT = 'Usa tres palabras que recuerdes, por ejemplo: perro azul ventana.';

/** Una contraseña corta o hecha solo de números se adivina en minutos si alguien copia los datos. */
export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres. ${PASSWORD_HINT}`);
  }
  if (/^\d+$/.test(password) && password.length < 12) {
    throw new Error(`Una contraseña solo de números (como una fecha o el PIN del celular) es fácil de adivinar. ${PASSWORD_HINT}`);
  }
  if (new Set(password.toLowerCase()).size < 4) {
    throw new Error(`La contraseña repite demasiado los mismos caracteres. ${PASSWORD_HINT}`);
  }
}

/** Sello cifrado con el total de registros y la huella final: revela registros quitados al final. */
async function seal(key, log) {
  return encryptJson(key, { total: log.length, huellaFinal: log.length ? log[log.length - 1].huella : '' });
}

const BACKUP_KEY_RE = /^(log|plan|sello|extra:(?:caso|fichas)|file:[0-9a-f]{16})$/;

/** Datos cifrados que no son pruebas: el seguimiento del caso y las fichas de otras víctimas. */
const EXTRAS = new Set(['caso', 'fichas']);

const JSON_WS = ' \t\n\r';

/** Fin de un texto JSON que empieza en i (comilla de apertura), o -1 si falta texto. */
function skipString(s, i) {
  let j = i + 1;
  for (;;) {
    const k = s.indexOf('"', j);
    if (k < 0) return -1;
    let barras = 0;
    while (s.charCodeAt(k - 1 - barras) === 92) barras++;
    if (barras % 2 === 0) return k + 1;
    j = k + 1;
  }
}

/** Fin del valor JSON que empieza en i, o -1 si todavía falta texto por leer. */
function skipValue(s, i, eof) {
  const c = s[i];
  if (c === undefined) return -1;
  if (c === '"') return skipString(s, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const ch = s.charCodeAt(j);
      if (ch === 34) {
        const end = skipString(s, j);
        if (end < 0) return -1;
        j = end - 1;
      } else if (ch === 123 || ch === 91) {
        depth++;
      } else if ((ch === 125 || ch === 93) && --depth === 0) {
        return j + 1;
      }
    }
    return -1;
  }
  let j = i;
  while (j < s.length && !',}]'.includes(s[j]) && !JSON_WS.includes(s[j])) j++;
  return j < s.length || eof ? j : -1;
}

/**
 * Lee una copia desde un Blob/File por partes, sin armar un texto gigante (los
 * navegadores no aceptan textos de más de ~500 MB). Da lo mismo que JSON.parse,
 * pero cada valor de "items" se interpreta por separado.
 */
export async function parseBackupBlob(blob, chunkSize = 4 * 1024 * 1024) {
  const bad = () => new Error('JSON inválido');
  const dec = new TextDecoder();
  let pos = 0;
  let buf = '';
  let i = 0;
  let eof = false;
  // Agrega el siguiente trozo (al menos min bytes); descarta lo ya leído (lo anterior a i).
  const more = async (min = 0) => {
    if (pos >= blob.size) {
      eof = true;
      return false;
    }
    const size = Math.max(chunkSize, min);
    const bytes = new Uint8Array(await blob.slice(pos, pos + size).arrayBuffer());
    pos += size;
    buf = buf.slice(i) + dec.decode(bytes, { stream: pos < blob.size });
    i = 0;
    return true;
  };
  const ws = async () => {
    for (;;) {
      while (i < buf.length && JSON_WS.includes(buf[i])) i++;
      if (i < buf.length || !(await more())) return;
    }
  };
  const take = async (ch) => {
    await ws();
    if (buf[i] !== ch) throw bad();
    i++;
  };
  const value = async () => {
    await ws();
    for (;;) {
      const end = skipValue(buf, i, eof);
      if (end >= 0) {
        const text = buf.slice(i, end);
        i = end;
        return JSON.parse(text);
      }
      // Un valor grande (una prueba) se completa leyendo cada vez el doble:
      // así no se vuelve a recorrer muchas veces.
      if (!(await more(buf.length - i))) throw bad();
    }
  };
  // Lee "clave": valor, ... hasta la llave de cierre.
  const members = async (onMember) => {
    await ws();
    if (buf[i] === '}') { i++; return; }
    for (;;) {
      const key = await value();
      if (typeof key !== 'string') throw bad();
      await take(':');
      await onMember(key);
      await ws();
      if (buf[i] === ',') { i++; continue; }
      if (buf[i] === '}') { i++; return; }
      throw bad();
    }
  };

  const data = Object.create(null);
  await take('{');
  await members(async (key) => {
    await ws();
    if (key === 'items' && buf[i] === '{') {
      i++;
      const items = Object.create(null);
      await members(async (k) => { items[k] = await value(); });
      data.items = items;
    } else {
      data[key] = await value();
    }
  });
  await ws();
  if (i < buf.length) throw bad();
  return data;
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

  static async create(storage, password, { iterations = KDF_ITERATIONS, creadoEn = new Date().toISOString(), checkPolicy = true } = {}) {
    if (checkPolicy) checkPassword(password);
    if (await Vault.exists(storage)) throw new Error('Ya existe una bitácora en este teléfono.');
    const meta = { format: FORMAT, version: VERSION, salt: newSalt(), iterations, creadoEn };
    const key = await deriveKey(password, meta.salt, iterations);
    await storage.setMany({ meta, log: await encryptJson(key, []), sello: await seal(key, []) });
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
    await this.storage.setMany({ log: await encryptJson(this.key, this.log), sello: await seal(this.key, this.log) });
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
    writes.sello = await seal(this.key, log);
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

  /** Lee un dato cifrado fuera de la bitácora (no forma parte de la cadena de pruebas). */
  async getExtra(name, fallback = null) {
    if (!EXTRAS.has(name)) throw new Error('Dato desconocido.');
    const box = await this.storage.get('extra:' + name);
    return box ? decryptJson(this.key, box) : fallback;
  }

  async saveExtra(name, value) {
    if (!EXTRAS.has(name)) throw new Error('Dato desconocido.');
    if (value === null || value === undefined) await this.storage.del('extra:' + name);
    else await this.storage.set('extra:' + name, await encryptJson(this.key, value));
  }

  /**
   * Borrador cifrado: lo que la persona estaba escribiendo cuando la app se
   * bloqueó sola. No entra en la bitácora ni en las copias de seguridad.
   */
  async saveDraft({ campos, archivos = [] }) {
    const writes = { borrador: await encryptJson(this.key, { campos, archivos: archivos.map((a) => ({ nombre: a.nombre, tipo: a.tipo, recibida: Boolean(a.recibida) })) }) };
    for (let i = 0; i < archivos.length; i++) writes['borrador:' + i] = await encryptBytes(this.key, archivos[i].bytes);
    await this.storage.setMany(writes);
  }

  /** Devuelve el borrador (si hay) y lo elimina. */
  async takeDraft() {
    const box = await this.storage.get('borrador');
    const keys = (await this.storage.keys()).filter((k) => k === 'borrador' || k.startsWith('borrador:'));
    if (!box) {
      for (const k of keys) await this.storage.del(k);
      return null;
    }
    let result;
    try {
      const draft = await decryptJson(this.key, box);
      const archivos = [];
      for (let i = 0; i < draft.archivos.length; i++) {
        const fileBox = await this.storage.get('borrador:' + i);
        if (fileBox) archivos.push({ ...draft.archivos[i], bytes: await decryptBytes(this.key, fileBox) });
      }
      result = { campos: draft.campos, archivos };
    } catch {
      result = { perdido: true };
    }
    // Se borra siempre, aunque no se haya podido descifrar.
    for (const k of keys) await this.storage.del(k);
    return result;
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
    // Pruebas guardadas que ningún registro menciona: alguien pudo borrar registros.
    const referenced = new Set(this.log.flatMap((e) => (e.adjuntos || []).map((a) => 'file:' + a.id)));
    const archivosHuerfanos = (await this.storage.keys()).filter((k) => k.startsWith('file:') && !referenced.has(k));
    let sello = 'ausente';
    const box = await this.storage.get('sello');
    if (box) {
      try {
        const s = await decryptJson(this.key, box);
        const last = this.log.length ? this.log[this.log.length - 1].huella : '';
        sello = s.total === this.log.length && s.huellaFinal === last ? 'ok' : 'distinto';
      } catch {
        sello = 'distinto';
      }
    }
    return {
      ...chain, archivosAlterados, archivosHuerfanos, sello,
      ok: chain.ok && archivosAlterados.length === 0 && archivosHuerfanos.length === 0 && sello !== 'distinto',
    };
  }

  /**
   * Copia de seguridad (sigue cifrada: sin la contraseña no sirve de nada).
   * Se arma como Blob por partes: un solo texto gigante fallaba con cientos de
   * MB de pruebas. El JSON es el mismo de siempre, así las copias viejas y
   * nuevas se abren igual.
   */
  async exportBackup() {
    let blob = new Blob([]);
    let parts = [`{"format":${JSON.stringify(FORMAT + '/copia')},"version":${VERSION},"meta":${JSON.stringify(this.meta)},"items":{`];
    let pending = 0;
    let first = true;
    for (const key of await this.storage.keys()) {
      if (!BACKUP_KEY_RE.test(key)) continue;
      const piece = (first ? '' : ',') + JSON.stringify(key) + ':' + JSON.stringify(await this.storage.get(key));
      first = false;
      parts.push(piece);
      pending += piece.length;
      // Pasa lo acumulado al Blob para que esos textos se puedan liberar.
      if (pending > 8 * 1024 * 1024) {
        blob = new Blob([blob, ...parts]);
        parts = [];
        pending = 0;
      }
    }
    parts.push('}}');
    return new Blob([blob, ...parts], { type: 'application/json' });
  }

  /**
   * Restaura una copia en un teléfono. source: el texto de la copia o el
   * Blob/File elegido (se lee por partes). Comprueba la contraseña antes de
   * escribir nada.
   */
  static async importBackup(storage, source, password) {
    let data;
    try {
      data = typeof source === 'string'
        ? JSON.parse(source)
        : await parseBackupBlob(source instanceof Blob ? source : new Blob([source]));
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
      if (BACKUP_KEY_RE.test(k)) items[k] = v;
    }
    await storage.setMany({ ...items, meta: data.meta }, { replace: true });
    return new Vault(storage, key, data.meta, log);
  }

  /**
   * Vuelve a cifrar todo (bitácora, sello, plan, pruebas y borrador) con la
   * nueva contraseña y el número de iteraciones actual, en una sola escritura.
   * Un archivo que ya no se podía descifrar no frena el cambio: queda como
   * estaba y se devuelve en danados (ids de adjunto). Un borrador ilegible
   * también queda como estaba: takeDraft avisará que se perdió.
   */
  async changePassword(newPassword) {
    checkPassword(newPassword);
    const meta = { ...this.meta, salt: newSalt(), iterations: Math.max(this.meta.iterations, KDF_ITERATIONS) };
    const key = await deriveKey(newPassword, meta.salt, meta.iterations);
    const entries = { meta, log: await encryptJson(key, this.log), sello: await seal(key, this.log) };
    for (const k of ['plan', ...[...EXTRAS].map((n) => 'extra:' + n)]) {
      const box = await this.storage.get(k);
      if (box) entries[k] = await encryptJson(key, await decryptJson(this.key, box));
    }
    const danados = [];
    for (const k of await this.storage.keys()) {
      const esArchivo = k.startsWith('file:');
      if (!esArchivo && k !== 'borrador' && !k.startsWith('borrador:')) continue;
      try {
        entries[k] = await encryptBytes(key, await decryptBytes(this.key, await this.storage.get(k)));
      } catch {
        if (esArchivo) danados.push(k.slice(5));
      }
    }
    await this.storage.setMany(entries);
    this.key = key;
    this.meta = meta;
    return { danados };
  }
}
