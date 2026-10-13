import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExif, describeExif } from '../js/core/exif.js';

/** Arma un JPEG mínimo con EXIF (marca, modelo, fecha y GPS) en el orden de bytes pedido. */
export function jpegWithExif({ le = false, lat = [12, 2, 47.04], latRef = 'S', lon = [77, 2, 34.08], lonRef = 'W' } = {}) {
  const buf = [];
  const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  // Diseño: header(8) | IFD0 | ExifIFD | GPS IFD | datos
  const make = ascii('samsung'); const model = ascii('SM-A145M'); const date = ascii('2026:10:11 19:42:05');
  const ifd0At = 8; const ifd0Len = 2 + 4 * 12 + 4;
  const exifAt = ifd0At + ifd0Len; const exifLen = 2 + 2 * 12 + 4;
  const gpsAt = exifAt + exifLen; const gpsLen = 2 + 4 * 12 + 4;
  let dataAt = gpsAt + gpsLen;
  const data = [];
  const put = (bytes) => { const at = dataAt + data.length; data.push(...bytes); return at; };
  const entry = (tag, type, count, valueBytesOrOffset) => [...u16(tag), ...u16(type), ...u32(count), ...valueBytesOrOffset];
  const rational = (arr) => arr.flatMap((v) => [...u32(Math.round(v * 100)), ...u32(100)]);
  const refBytes = (r) => [r.charCodeAt(0), 0, 0, 0];
  const ifd0 = [...u16(4),
    ...entry(0x010f, 2, make.length, u32(put(make))),
    ...entry(0x0110, 2, model.length, u32(put(model))),
    ...entry(0x8769, 4, 1, u32(exifAt)),
    ...entry(0x8825, 4, 1, u32(gpsAt)), ...u32(0)];
  const exif = [...u16(2),
    ...entry(0x9003, 2, date.length, u32(put(date))),
    ...entry(0x9011, 2, 7, u32(put(ascii('-05:00')))), ...u32(0)];
  const gps = [...u16(4),
    ...entry(1, 2, 2, refBytes(latRef)),
    ...entry(2, 5, 3, u32(put(rational(lat)))),
    ...entry(3, 2, 2, refBytes(lonRef)),
    ...entry(4, 5, 3, u32(put(rational(lon)))), ...u32(0)];
  const tiff = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...ifd0, ...exif, ...gps, ...data];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  buf.push(0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9);
  return new Uint8Array(buf);
}

for (const le of [false, true]) {
  test(`readExif lee GPS, equipo y fecha (${le ? 'little' : 'big'} endian)`, () => {
    const m = readExif(jpegWithExif({ le }));
    assert.equal(m.marca, 'samsung');
    assert.equal(m.modelo, 'SM-A145M');
    assert.equal(m.fechaOriginal, '2026-10-11T19:42:05-05:00');
    assert.ok(Math.abs(m.gps.lat - -12.046400) < 1e-5, m.gps.lat);
    assert.ok(Math.abs(m.gps.lon - -77.042800) < 1e-5, m.gps.lon);
    assert.match(describeExif(m), /GPS -12\.0464\d*, -77\.0428\d* · equipo samsung SM-A145M · tomada 2026-10-11 19:42:05/);
  });
}

test('readExif ignora archivos sin EXIF, no JPEG o dañados', () => {
  assert.equal(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
  assert.equal(readExif(new Uint8Array(0)), null);
  const good = jpegWithExif();
  // Cortado a la mitad o con bytes al azar: nunca lanza error.
  for (let n = 4; n < good.length; n += 7) readExif(good.slice(0, n));
  for (let i = 0; i < 300; i++) {
    const bad = good.slice();
    for (let k = 0; k < 5; k++) bad[6 + Math.floor(Math.random() * (bad.length - 6))] = Math.floor(Math.random() * 256);
    readExif(bad);
  }
});

test('readExif descarta coordenadas 0,0', () => {
  const m = readExif(jpegWithExif({ lat: [0, 0, 0], lon: [0, 0, 0] }));
  assert.equal(m.gps, undefined);
  assert.equal(m.modelo, 'SM-A145M');
});

test('las fotos con GPS quedan en la cadena, en el informe y en los datos para la Fiscalía', async () => {
  const { Vault } = await import('../js/core/vault.js');
  const { MemoryStorage } = await import('../js/core/storage.js');
  const { buildTextReport, buildReportBody } = await import('../js/core/report.js');
  const { readFileSync } = await import('node:fs');
  const vault = await Vault.create(new MemoryStorage(), 'clave larga 123');
  const photo = new Uint8Array(readFileSync(new URL('./fixtures/foto-gps.jpg', import.meta.url)));
  const e = await vault.add({
    ocurridoEn: '2026-10-12T09:00:00-05:00', canal: 'whatsapp', contacto: '987654321',
    mensaje: 'Ya sabemos dónde vives', medioPago: 'yape', cuentaPago: '912345678', titularCuenta: 'Juan Pér* Ram*',
  }, [{ nombre: 'casa.jpg', tipo: 'image/jpeg', bytes: photo }, { nombre: 'nota.txt', tipo: 'text/plain', bytes: new TextEncoder().encode('hola') }]);
  assert.equal(e.adjuntos[0].metadatos.modelo, 'Redmi Note 13');
  assert.equal(e.adjuntos[1].metadatos, undefined);
  assert.equal(e.titularCuenta, 'Juan Pér* Ram*');
  assert.equal((await vault.verify()).ok, true);
  // Cambiar el GPS registrado rompe la cadena.
  vault.log[0].adjuntos[0].metadatos.gps.lat = -12;
  assert.equal((await vault.verify()).ok, false);
  vault.log[0].adjuntos[0].metadatos.gps.lat = -11.975033;
  const text = buildTextReport(vault.log);
  assert.match(text, /Metadatos de fotos recibidas/);
  assert.match(text, /casa\.jpg .*GPS -11\.975033, -76\.987583 \(154 m\) https:\/\/maps\.google\.com\/\?q=-11\.975033,-76\.987583 · equipo Xiaomi Redmi Note 13/);
  assert.match(text, /titular mostrado: Juan Pér\* Ram\*/);
  const html = buildReportBody(vault.log);
  assert.match(html, /<strong>Con GPS\.<\/strong> casa\.jpg/);
  assert.match(html, /Titular mostrado: <strong>Juan Pér\* Ram\*<\/strong>/);
});
