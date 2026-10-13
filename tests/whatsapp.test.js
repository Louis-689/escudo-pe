import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseWhatsAppChat, chatToIncidents, fnv1a64 } from '../js/core/whatsapp.js';
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

// ---------- Orden de la fecha (día/mes o mes/día) ----------

const NOW = new Date('2026-10-13T12:00:00-05:00');

test('mes/día sin números mayores a 12: elige la lectura que no retrocede ni es futura', () => {
  // Día/mes daría 9 dic 2026 (futuro) y luego 10 ene 2026 (retrocede).
  const chat = parseWhatsAppChat('9/12/26, 10:00 - Bob: pay\n10/1/26, 10:00 - Bob: now', { now: NOW });
  assert.equal(chat.orden, 'mes');
  assert.equal(chat.diaPrimero, false);
  assert.equal(chat.ambiguo, false);
  assert.equal(chat.mensajes[0].fecha, '2026-09-12T10:00:00-05:00');
  assert.equal(chat.mensajes[1].fecha, '2026-10-01T10:00:00-05:00');
});

test('descarta la lectura que deja mensajes en el futuro', () => {
  const chat = parseWhatsAppChat('10/12/26, 10:00 - Bob: pay up', { now: NOW });
  assert.equal(chat.orden, 'mes', 'día/mes sería 10 de diciembre, aún no llega');
  assert.equal(chat.mensajes[0].fecha, '2026-10-12T10:00:00-05:00');
});

test('"PM" sin puntos (inglés de EE. UU.) decide mes/día cuando ambas lecturas son creíbles', () => {
  const chat = parseWhatsAppChat('5/10/26, 9:00 PM - Bob: pay\n5/10/26, 9:01 PM - Bob: now', { now: NOW });
  assert.equal(chat.orden, 'mes');
  assert.equal(chat.ambiguo, false);
  assert.equal(chat.mensajes[0].fecha, '2026-05-10T21:00:00-05:00');
});

test('aviso de cifrado de iPhone (a nombre del chat) también es pista de idioma', () => {
  const en = parseWhatsAppChat('[5/10/26, 21:00:00] Bob: Messages and calls are end-to-end encrypted.\n[5/10/26, 21:01:00] Bob: pay', { now: NOW });
  assert.deepEqual([en.orden, en.ambiguo], ['mes', true]);
  const es = parseWhatsAppChat('[5/10/26, 21:00:00] Bob: Los mensajes y las llamadas están cifrados de extremo a extremo.\n[5/10/26, 21:01:00] Bob: paga', { now: NOW });
  assert.deepEqual([es.orden, es.ambiguo], ['dia', false]);
});

test('mensajes del sistema en inglés y 24 horas: mes/día, pero pide confirmar', () => {
  const chat = parseWhatsAppChat('5/10/26, 21:00 - Messages and calls are end-to-end encrypted.\n5/10/26, 21:01 - Bob: pay', { now: NOW });
  assert.equal(chat.orden, 'mes');
  assert.equal(chat.ambiguo, true);
});

test('español ("p. m." y mensajes del sistema) es día/mes aunque ambas lecturas sean creíbles', async () => {
  const later = new Date('2027-06-01T00:00:00Z');
  const chat = parseWhatsAppChat(await readFile(fixture('chat-android.txt'), 'utf8'), { now: later });
  assert.equal(chat.orden, 'dia');
  assert.equal(chat.ambiguo, false);
  assert.equal(chat.mensajes[2].fecha, '2026-10-11T21:16:00-05:00');
  const h24 = parseWhatsAppChat('5/10/26, 21:00 - Los mensajes y las llamadas están cifrados de extremo a extremo.\n5/10/26, 21:01 - Bob: hola', { now: NOW });
  assert.deepEqual([h24.orden, h24.ambiguo], ['dia', false]);
});

test('sin pistas y ambas lecturas creíbles: día/mes, ambiguo y muestras para preguntar', () => {
  const text = '5/10/26, 21:00 - Bob: a\n6/10/26, 21:00 - Bob: b';
  const chat = parseWhatsAppChat(text, { now: NOW });
  assert.equal(chat.orden, 'dia');
  assert.equal(chat.ambiguo, true);
  assert.equal(chat.mensajes[0].fecha, '2026-10-05T21:00:00-05:00');
  assert.deepEqual(chat.muestras, {
    texto: '5/10/26',
    dia: { ejemplo: '2026-10-05T21:00:00-05:00', desde: '2026-10-05T21:00:00-05:00', hasta: '2026-10-06T21:00:00-05:00' },
    mes: { ejemplo: '2026-05-10T21:00:00-05:00', desde: '2026-05-10T21:00:00-05:00', hasta: '2026-06-10T21:00:00-05:00' },
  });
  const forzado = parseWhatsAppChat(text, { now: NOW, orden: 'mes' });
  assert.deepEqual([forzado.orden, forzado.diaPrimero, forzado.ambiguo], ['mes', false, false]);
  assert.equal(forzado.mensajes[1].fecha, '2026-06-10T21:00:00-05:00');
});

test('un orden impuesto con fechas imposibles se ignora', () => {
  const chat = parseWhatsAppChat('13/10/26, 21:00 - Bob: a', { now: NOW, orden: 'mes' });
  assert.equal(chat.orden, 'dia');
  assert.equal(chat.mensajes[0].fecha, '2026-10-13T21:00:00-05:00');
  assert.equal(chat.muestras, null);
});

test('fechas iguales en ambos órdenes no son ambiguas', () => {
  const chat = parseWhatsAppChat('10/10/26, 10:00 - Bob: a\n10/10/26, 10:05 - Bob: b', { now: NOW });
  assert.deepEqual([chat.orden, chat.ambiguo, chat.muestras], ['dia', false, null]);
});

test('un mensaje unos minutos fuera de orden no cambia la lectura', () => {
  const chat = parseWhatsAppChat('5/10/26, 21:00 - Bob: a\n5/10/26, 20:55 - Bob: b\n7/10/26, 9:00 - Bob: c', { now: NOW });
  // Sin tolerancia, día/mes "retrocedería" 5 minutos y ganaría mes/día (10 may–10 jul).
  assert.deepEqual([chat.orden, chat.ambiguo], ['dia', true]);
  // Un retroceso de meses sí descarta la lectura.
  const mal = parseWhatsAppChat('5/10/26, 21:00 - Bob: a\n3/11/26, 9:00 - Bob: b', { now: new Date('2026-12-01T00:00:00Z') });
  assert.equal(mal.orden, 'dia', 'mes/día iría del 10 de mayo al 11 de marzo');
  assert.equal(mal.ambiguo, false);
});

test('una línea con fecha imposible en ambos órdenes es texto, no un mensaje nuevo', () => {
  const chat = parseWhatsAppChat('5/10/26, 21:00 - Bob: mira\n32/13/26, 10:00 - esto es texto', { now: NOW });
  assert.equal(chat.mensajes.length, 1);
  assert.equal(chat.mensajes[0].texto, 'mira\n32/13/26, 10:00 - esto es texto');
});

// ---------- Huellas y reimportación ----------

test('fnv1a64 coincide con los valores de referencia de FNV-1a de 64 bits', () => {
  const ref = (s) => {
    let h = 0xcbf29ce484222325n;
    for (const b of new TextEncoder().encode(s)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
    return h.toString(16).padStart(16, '0');
  };
  assert.equal(fnv1a64(''), 'cbf29ce484222325');
  assert.equal(fnv1a64('a'), 'af63dc4c8601ec8c');
  assert.equal(fnv1a64('foobar'), '85944171f73967e8');
  for (const s of ['Último aviso', 'yapear 3 mil 🔪', 'x'.repeat(5000)]) assert.equal(fnv1a64(s), ref(s));
});

test('cada mensaje tiene una huella estable (también con saltos de línea de Windows)', async () => {
  const text = await readFile(fixture('chat-android.txt'), 'utf8');
  const a = parseWhatsAppChat(text);
  const b = parseWhatsAppChat(text.replace(/\n/g, '\r\n'));
  assert.ok(a.mensajes.every((m) => /^[0-9a-f]{16}$/.test(m.huella)));
  assert.deepEqual(a.mensajes.map((m) => m.huella), b.mensajes.map((m) => m.huella));
  assert.equal(new Set(a.mensajes.map((m) => m.huella)).size, a.mensajes.length);
  // Formato fijo (no cambiarlo: las huellas guardadas dejarían de coincidir).
  const m = a.mensajes[3];
  assert.equal(m.huella, fnv1a64(`${m.autor}\u001f${m.fecha}\u001f${m.texto}\u001f${m.adjuntos.join('\u001e')}`));
  assert.equal(m.huella, 'e51df854fe8865f1');
});

test('reimportar el chat actualizado solo trae los mensajes nuevos', async () => {
  const autor = '+51 987 654 321';
  const viejo = parseWhatsAppChat(await readFile(fixture('chat-android.txt'), 'utf8'));
  const primera = chatToIncidents(viejo, [autor], { archivo: 'chat.txt' });
  assert.equal(primera.repetidos, 0);
  assert.deepEqual(primera.map((i) => i.huellasChat.length), [3, 1, 1]);
  const existentes = new Set(primera.flatMap((i) => i.huellasChat));

  const nuevo = parseWhatsAppChat(await readFile(fixture('chat-android-actualizado.txt'), 'utf8'));
  // Los mensajes que ya estaban conservan su huella en la nueva exportación.
  assert.deepEqual(nuevo.mensajes.slice(0, 7).map((m) => m.huella), viejo.mensajes.map((m) => m.huella));
  // El mismo texto repetido en el mismo minuto es otro mensaje.
  assert.notEqual(nuevo.mensajes[7].huella, nuevo.mensajes[6].huella);

  const segunda = chatToIncidents(nuevo, [autor], { archivo: 'chat.txt', existentes });
  assert.equal(segunda.repetidos, 5);
  assert.equal(segunda.length, 2, 'el "Último aviso" repetido y la amenaza de las 8:31');
  assert.equal(segunda[0].mensaje, 'Último aviso');
  assert.equal(segunda[0].ocurridoEn, '2026-10-12T00:05:00-05:00');
  assert.match(segunda[0].descripcion, /línea 9\)/);
  assert.equal(segunda[1].mensaje, '[08:31] Se van a arrepentir\n[08:31] (archivo)');
  assert.deepEqual(segunda[1].adjuntoNombres, ['IMG-20261012-WA0002.jpg']);
  assert.ok(segunda.flatMap((i) => i.huellasChat).every((h) => !existentes.has(h)));

  // existentes también puede ser una lista; si todo está importado no queda nada.
  const todo = [...existentes, ...segunda.flatMap((i) => i.huellasChat)];
  const tercera = chatToIncidents(nuevo, [autor], { existentes: todo });
  assert.deepEqual([tercera.length, tercera.repetidos], [0, 8]);
});

test('un mensaje antes omitido y ahora exportado "con archivos" se vuelve a importar', () => {
  const sin = parseWhatsAppChat('11/10/26, 9:45 p. m. - Bob: <Multimedia omitido>', { now: NOW });
  const con = parseWhatsAppChat('11/10/26, 9:45 p. m. - Bob: IMG-1.jpg (archivo adjunto)', { now: NOW });
  const existentes = new Set(chatToIncidents(sin, ['Bob']).flatMap((i) => i.huellasChat));
  const inc = chatToIncidents(con, ['Bob'], { existentes });
  assert.deepEqual(inc[0].adjuntoNombres, ['IMG-1.jpg']);
  assert.equal(inc.repetidos, 0);
});
