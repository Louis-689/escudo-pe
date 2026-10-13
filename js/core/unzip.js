// Lee archivos ZIP (sin compresión o "deflate"), como el chat que exporta
// WhatsApp en iPhone. Usa DecompressionStream del navegador, sin dependencias.
//
// El ZIP viene de fuera (lo eligió la persona, pero pudo llegarle manipulado):
// se comprueba cada posición antes de leerla y se descomprime por partes,
// cortando apenas se pasa del tamaño declarado o del límite total.

import { crc32 } from './zip.js';

// Límite para no agotar la memoria con archivos manipulados ("bombas ZIP").
export const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;

export const ZIP_DANADO = 'El ZIP está dañado o incompleto. Vuelve a exportar el chat.';
const ZIP_GRANDE = 'El ZIP es demasiado grande para abrirlo en el teléfono.';

/** Errores con un mensaje ya pensado para la persona (no se reemplazan por el genérico). */
class ZipError extends Error {}

function danado() {
  return new ZipError(ZIP_DANADO);
}

/**
 * Descomprime "deflate" leyendo por partes. limit: máximo de bytes que puede
 * salir (el tamaño declarado o lo que queda del límite total, lo que sea menor).
 */
async function inflateRaw(bytes, limit) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('Este navegador no puede abrir archivos ZIP comprimidos. Descomprímelo y elige los archivos sueltos.');
  }
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw danado();
      chunks.push(value);
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    throw err;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/** Devuelve [{ name, bytes }] con los archivos del ZIP (sin carpetas). */
export async function readZip(bytes) {
  try {
    return await readEntries(bytes);
  } catch (err) {
    if (err instanceof ZipError) throw new Error(err.message);
    // RangeError de DataView, TypeError del descompresor, lectura cortada…
    throw new Error(ZIP_DANADO);
  }
}

async function readEntries(bytes) {
  if (!(bytes instanceof Uint8Array)) throw danado();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Comprueba que [off, off + len) está dentro del archivo antes de leer.
  const need = (off, len) => {
    if (!Number.isInteger(off) || off < 0 || len < 0 || off + len > bytes.length) throw danado();
  };

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('El archivo no es un ZIP válido.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    need(p, 46);
    if (view.getUint32(p, true) !== 0x02014b50) throw danado();
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    need(p + 46, nameLen + extraLen + commentLen);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;

    if (flags & 1) throw new ZipError(`"${name}" está protegido con contraseña. Vuelve a exportar el chat sin contraseña.`);
    // 0xffffffff indica ZIP64 (archivos de más de 4 GB): no cabe en un teléfono.
    if (size === 0xffffffff || compSize === 0xffffffff) throw new ZipError(ZIP_GRANDE);
    total += size;
    if (total > MAX_UNZIPPED_BYTES) throw new ZipError(ZIP_GRANDE);

    need(local, 30);
    if (view.getUint32(local, true) !== 0x04034b50) throw danado();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    need(start, compSize);
    const data = bytes.subarray(start, start + compSize);
    let content;
    if (method === 0) {
      if (compSize !== size) throw danado();
      content = data.slice();
    } else if (method === 8) {
      // La suma de tamaños declarados ya respeta el límite total: basta con
      // cortar en cuanto lo descomprimido pase del tamaño declarado.
      content = await inflateRaw(data, size);
    } else {
      throw new ZipError(`"${name}" usa una compresión no soportada. Vuelve a exportar el chat.`);
    }
    if (content.length !== size || crc32(content) !== crc) {
      throw new ZipError(`"${name}" está dañado dentro del ZIP. Vuelve a exportar el chat.`);
    }
    out.push({ name: name.split('/').pop(), bytes: content });
  }
  return out;
}
