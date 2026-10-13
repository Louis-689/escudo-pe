import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseWhatsAppChat, chatToIncidents } from '../js/core/whatsapp.js';
import { readZip } from '../js/core/unzip.js';
import { createZip } from '../js/core/zip.js';
import { Vault } from '../js/core/vault.js';
import { MemoryStorage } from '../js/core/storage.js';

const fixture = (name) => new URL('fixtures/' + name, import.meta.url);

test('lee el formato de Android en español (12 horas, líneas múltiples, adjuntos)', async () => {
  const chat = parseWhatsAppChat(await readFile(fixture('chat-android.txt'), 'utf8'));
  assert.equal(chat.mensajes.length, 7);
  assert.equal(chat.mensajes[0].autor, null, 'mensaje del sistema');
  assert.deepEqual(chat.participantes, [{ autor: '+51 987 654 321', total: 5 }, { autor: 'Rosa', total: 1 }]);
  const m = chat.mensajes[2];
  assert.equal(m.fecha, '2026-10-11T21:16:00-05:00');
  assert.equal(m.texto, 'Tiene hasta mañana para yapear 3 mil al 912 345 678\no ya sabe lo que pasa con su bodega');
  assert.deepEqual(chat.mensajes[3].adjuntos, ['IMG-20261013-WA0001.jpg']);
  assert.equal(chat.mensajes[5].omitidos, 1);
  assert.equal(chat.mensajes[6].fecha, '2026-10-12T00:05:00-05:00', '12:05 a. m. es medianoche');
});

test('lee el formato de iPhone dentro de un ZIP comprimido', async () => {
  const files = await readZip(new Uint8Array(await readFile(fixture('chat-ios.zip'))));
  assert.deepEqual(files.map((f) => f.name).sort(), ['00000012-AUDIO-2026-10-13-21-15-40.opus', '_chat.txt']);
  const chat = parseWhatsAppChat(new TextDecoder().decode(files.find((f) => f.name === '_chat.txt').bytes));
  assert.equal(chat.mensajes[0].autor, '+58 412 555 1234');
  assert.equal(chat.mensajes[0].fecha, '2026-10-11T21:15:03-05:00');
  assert.deepEqual(chat.mensajes[1].adjuntos, ['00000012-AUDIO-2026-10-13-21-15-40.opus']);
});

test('readZip también lee ZIP sin compresión y rechaza archivos que no son ZIP', async () => {
  const files = await readZip(createZip([{ name: 'a/b.txt', bytes: 'hola' }]));
  assert.deepEqual(files.map((f) => f.name), ['b.txt']);
  await assert.rejects(readZip(new TextEncoder().encode('no soy un zip, soy texto plano suficientemente largo')), /ZIP válido/);
});

test('detecta formato mes/día (inglés de EE. UU.)', () => {
  const chat = parseWhatsAppChat('10/13/26, 9:15 PM - Bob: pay up\n10/14/26, 21:00 - Bob: last');
  assert.equal(chat.diaPrimero, false);
  assert.equal(chat.mensajes[0].fecha, '2026-10-13T21:15:00-05:00');
});

test('chatToIncidents agrupa mensajes seguidos del extorsionador', async () => {
  const chat = parseWhatsAppChat(await readFile(fixture('chat-android.txt'), 'utf8'));
  const inc = chatToIncidents(chat, ['+51 987 654 321'], { archivo: 'chat.txt' });
  assert.equal(inc.length, 3, '21:15–21:16, 21:45 y 00:05');
  assert.equal(inc[0].contacto, '+51 987 654 321');
  assert.equal(inc[0].canal, 'whatsapp');
  assert.match(inc[0].mensaje, /^\[21:15\] Buenas noches/);
  assert.deepEqual(inc[0].adjuntoNombres, ['IMG-20261013-WA0001.jpg']);
  assert.match(inc[0].descripcion, /líneas 2–5/);
  assert.match(inc[1].descripcion, /no se incluyeron/);
});

test('vault.addMany guarda todos los registros importados de una vez', async () => {
  const v = await Vault.create(new MemoryStorage(), 'clave-segura', { iterations: 1000 });
  const chat = parseWhatsAppChat(await readFile(fixture('chat-android.txt'), 'utf8'));
  const items = chatToIncidents(chat, ['+51 987 654 321']).map(({ adjuntoNombres, ...input }) => ({
    input, files: adjuntoNombres.map((n) => ({ nombre: n, tipo: 'image/jpeg', bytes: new Uint8Array([1]) })),
  }));
  await v.addMany(items, new Date('2026-10-15T00:00:00Z'));
  assert.equal(v.log.length, 3);
  assert.equal((await v.verify()).ok, true);
});
