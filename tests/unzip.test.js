import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readZip, MAX_UNZIPPED_BYTES, ZIP_DANADO } from '../js/core/unzip.js';
import { createZip, crc32 } from '../js/core/zip.js';

const enc = new TextEncoder();

/** Arma un ZIP de una entrada; permite mentir en el tamaño declarado. */
function zipOne(name, data, { method = 8, size = data.length, crc = crc32(data), flags = 0x0800 } = {}) {
  const n = enc.encode(name);
  const body = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(6, flags, true);
  local.setUint16(8, method, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, body.length, true);
  local.setUint32(22, size, true);
  local.setUint16(26, n.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(8, flags, true);
  central.setUint16(10, method, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, body.length, true);
  central.setUint32(24, size, true);
  central.setUint16(28, n.length, true);
  central.setUint32(42, 0, true);
  const cdOffset = 30 + n.length + body.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + n.length, true);
  end.setUint32(16, cdOffset, true);
  const parts = [new Uint8Array(local.buffer), n, body, new Uint8Array(central.buffer), n, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let pos = 0;
  for (const x of parts) { out.set(x, pos); pos += x.length; }
  return out;
}

const chat = enc.encode('[12/10/26, 20:30:00] Extorsionador: paga o ya sabes\n'.repeat(50));

test('lee un ZIP con deflate y otro sin compresión', async () => {
  const [f] = await readZip(zipOne('carpeta/_chat.txt', chat));
  assert.equal(f.name, '_chat.txt');
  assert.deepEqual(f.bytes, chat);
  const stored = await readZip(createZip([{ name: 'a.txt', bytes: 'hola' }, { name: 'b/foto.jpg', bytes: new Uint8Array([1, 2]) }]));
  assert.deepEqual(stored.map((x) => x.name), ['a.txt', 'foto.jpg']);
});

test('corta la descompresión si sale más de lo declarado (bomba ZIP)', async () => {
  const big = new Uint8Array(5 * 1024 * 1024); // 5 MB de ceros: comprime a pocos KB
  await assert.rejects(readZip(zipOne('bomba.txt', big, { size: 1000, crc: 0 })), { message: ZIP_DANADO });
});

test('rechaza tamaños declarados por encima del límite total', async () => {
  await assert.rejects(readZip(zipOne('enorme.bin', chat, { size: MAX_UNZIPPED_BYTES + 1 })), /demasiado grande/);
});

test('un dato comprimido roto da un mensaje claro', async () => {
  const zip = zipOne('_chat.txt', chat);
  zip.fill(0xff, 40, 60); // dentro del bloque deflate
  await assert.rejects(readZip(zip), (err) => err.message === ZIP_DANADO || /dañado dentro del ZIP/.test(err.message));
});

test('posiciones fuera del archivo no se leen', async () => {
  const zip = zipOne('_chat.txt', chat);
  const view = new DataView(zip.buffer);
  const eocd = zip.length - 22;
  const cd = view.getUint32(eocd + 16, true);

  const badCd = zip.slice();
  new DataView(badCd.buffer).setUint32(eocd + 16, zip.length + 100, true);
  await assert.rejects(readZip(badCd), { message: ZIP_DANADO });

  const badLocal = zip.slice();
  new DataView(badLocal.buffer).setUint32(cd + 42, zip.length - 10, true);
  await assert.rejects(readZip(badLocal), { message: ZIP_DANADO });

  const badName = zip.slice();
  new DataView(badName.buffer).setUint16(cd + 28, 0xffff, true);
  await assert.rejects(readZip(badName), { message: ZIP_DANADO });

  const badComp = zip.slice();
  new DataView(badComp.buffer).setUint32(cd + 20, 0x7fffffff, true);
  await assert.rejects(readZip(badComp), { message: ZIP_DANADO });

  await assert.rejects(readZip(zip.subarray(0, zip.length - 30)), /no es un ZIP válido|dañado/);
  await assert.rejects(readZip(new Uint8Array(5)), /no es un ZIP válido/);
});

test('ZIP con contraseña o compresión rara: mensaje claro', async () => {
  await assert.rejects(readZip(zipOne('_chat.txt', chat, { flags: 0x0801 })), /protegido con contraseña/);
  await assert.rejects(readZip(zipOne('_chat.txt', chat, { method: 12 })), /compresión no soportada/);
});

test('bytes al azar nunca producen un error técnico', async () => {
  const base = zipOne('_chat.txt', chat);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const known = /ZIP está dañado|no es un ZIP válido|dañado dentro del ZIP|demasiado grande|protegido con contraseña|compresión no soportada/;
  for (let i = 0; i < 400; i++) {
    const z = base.slice();
    const flips = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < flips; k++) z[Math.floor(rnd() * z.length)] = Math.floor(rnd() * 256);
    try {
      await readZip(z);
    } catch (err) {
      assert.match(err.message, known);
    }
  }
});
