import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, createZip } from '../js/core/zip.js';

/** Lector mínimo de ZIP "store" para comprobar lo que escribimos. */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, 'fin de directorio');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), 0x02014b50, 'entrada central');
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(view.getUint32(local, true), 0x04034b50, 'cabecera local');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc, `CRC de ${name}`);
    out[name] = data;
    p += 46 + nameLen;
  }
  return out;
}

test('crc32 da el valor de referencia', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('createZip guarda archivos con nombres en UTF-8', () => {
  const zip = createZip([
    { name: 'leeme.txt', bytes: 'hola' },
    { name: 'pruebas/año-señal.bin', bytes: new Uint8Array([0, 255, 7]) },
  ], new Date('2026-10-13T10:00:00'));
  const files = readZip(zip);
  assert.deepEqual(Object.keys(files), ['leeme.txt', 'pruebas/año-señal.bin']);
  assert.equal(new TextDecoder().decode(files['leeme.txt']), 'hola');
  assert.deepEqual([...files['pruebas/año-señal.bin']], [0, 255, 7]);
});

test('createZip sin archivos produce un ZIP vacío válido', () => {
  assert.deepEqual(readZip(createZip([])), {});
});
