// Lee archivos ZIP (sin compresión o "deflate"), como el chat que exporta
// WhatsApp en iPhone. Usa DecompressionStream del navegador, sin dependencias.

import { crc32 } from './zip.js';

// Límite para no agotar la memoria con archivos manipulados ("bombas ZIP").
export const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no puede abrir archivos ZIP comprimidos. Descomprímelo y elige los archivos sueltos.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Devuelve [{ name, bytes }] con los archivos del ZIP (sin carpetas). */
export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un ZIP válido.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('El ZIP está dañado.');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder().decode(rawName);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;

    total += size;
    if (total > MAX_UNZIPPED_BYTES) throw new Error('El ZIP es demasiado grande para abrirlo en el teléfono.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compSize);
    let content;
    if (method === 0) content = data.slice();
    else if (method === 8) content = await inflateRaw(data);
    else throw new Error(`"${name}" usa una compresión no soportada.`);
    if (content.length !== size) throw new Error(`"${name}" está dañado dentro del ZIP.`);
    if (crc32(content) !== crc) throw new Error(`"${name}" está dañado dentro del ZIP.`);
    out.push({ name: name.split('/').pop(), bytes: content });
  }
  return out;
}
