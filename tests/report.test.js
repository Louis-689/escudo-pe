import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTextReport, buildHtmlReport, escapeHtml } from '../js/core/report.js';
import { appendEntry, createEntry } from '../js/core/model.js';

const NOW = new Date('2026-10-13T12:00:00Z');

async function sampleLog() {
  let log = [];
  log = await appendEntry(log, createEntry({
    ocurridoEn: '2026-10-12T20:30:00-05:00', canal: 'whatsapp', contacto: '987654321',
    mensaje: '<script>alert(1)</script> paga 5 mil', montoExigido: '5 mil', medioPago: 'yape', cuentaPago: '912345678',
    adjuntos: [{ id: 'a1', nombre: 'captura.jpg', tipo: 'image/jpeg', tamano: 10, sha256: 'f'.repeat(64) }],
  }, NOW));
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-10T09:00:00-05:00', canal: 'llamada', descripcion: 'Primera llamada' }, NOW));
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: log[0].id, descripcion: 'Volvieron a escribir' }, NOW));
  return log;
}

test('el informe de texto ordena por fecha y numera en orden', async () => {
  const text = buildTextReport(await sampleLog(), { verificacion: { ok: true }, generadoEn: NOW });
  const first = text.indexOf('#1 — 10/10/2026');
  const second = text.indexOf('#2 — 12/10/2026');
  assert.ok(first > 0 && second > first, text);
  assert.match(text, /Monto más alto exigido: S\/ 5,000\.00/);
  assert.match(text, /Yape: 912345678 \(1\)/);
  assert.match(text, /SHA-256 f{64}/);
  assert.match(text, /Nota del .*: Volvieron a escribir/);
  assert.match(text, /CORRECTA/);
  assert.match(text, /artículo 200/);
});

test('el informe HTML escapa el contenido escrito por terceros', async () => {
  const html = buildHtmlReport(await sampleLog(), { generadoEn: NOW });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('captura.jpg'));
});

test('informe vacío', () => {
  assert.match(buildHtmlReport([], { generadoEn: NOW }), /No hay incidentes/);
  assert.match(buildTextReport([], { generadoEn: NOW }), /Incidentes registrados: 0/);
});

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('el informe incluye datos para la Fiscalía, riesgos y cadena de custodia', async () => {
  let log = await sampleLog();
  log = await appendEntry(log, createEntry({ tipo: 'custodia', evento: 'paquete', descripcion: '2 pruebas' }, NOW));
  const opts = { generadoEn: NOW, creadoEn: '2026-10-01T15:00:00.000Z' };
  const text = buildTextReport(log, opts);
  assert.match(text, /DATOS PARA LA FISCALÍA/);
  assert.match(text, /\+51987654321 · Celular, Perú · 1 vez\/veces/);
  assert.match(text, /D\. Leg\. 1182/);
  assert.match(text, /Yape: 912345678/);
  assert.match(text, /CADENA DE CUSTODIA\n- Bitácora creada el 01\/10\/2026/);
  assert.match(text, /Generación del paquete de pruebas — 2 pruebas/);
  assert.doesNotMatch(text, /#3/, 'los eventos de custodia no son incidentes');
  const html = buildHtmlReport(log, opts);
  assert.match(html, /<h2>Datos para la Fiscalía<\/h2>/);
  assert.match(html, /<td>\+51987654321<\/td>/);
});

test('validación de eventos de custodia', () => {
  assert.throws(() => createEntry({ tipo: 'custodia', evento: 'inventado' }, NOW), /custodia no válido/);
});

const GPS = { gps: { lat: -12.046374, lon: -77.042793 }, marca: 'Samsung', modelo: 'A15' };
const foto = (nombre, extra) => ({ id: nombre, nombre, tipo: 'image/jpeg', tamano: 10, sha256: 'a'.repeat(64), metadatos: GPS, ...extra });

test('la ubicación de las fotos de la víctima nunca se imprime', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({
    ocurridoEn: '2026-10-12T20:30:00-05:00', canal: 'whatsapp', contacto: '987654321', mensaje: 'Mira tu casa',
    adjuntos: [foto('recibida.jpg', { recibida: true }), foto('mi-puerta.jpg')],
  }, NOW));
  const text = buildTextReport(log, { generadoEn: NOW });
  const detalle = text.slice(text.indexOf('DETALLE CRONOLÓGICO'));
  assert.match(detalle, /recibida\.jpg[^\n]*\n {4}Metadatos: GPS -12\.046374, -77\.042793[^\n]*maps\.google\.com/);
  assert.match(detalle, /mi-puerta\.jpg[^\n]*\n {4}Foto tomada por la víctima: ubicación omitida/);
  const conGps = (t) => t.split('\n').filter((l) => l.includes('-12.046374')).length;
  assert.equal(conGps(text), 2, 'solo la foto recibida (resumen y detalle)');
  const html = buildHtmlReport(log, { generadoEn: NOW });
  assert.match(html, /Foto tomada por la víctima: ubicación omitida/);
  assert.equal(html.match(/maps\.google\.com/g).length, 2);
  // Sin fotos recibidas no aparece ninguna coordenada.
  let propio = [];
  propio = await appendEntry(propio, createEntry({ ocurridoEn: '2026-10-12T20:30:00-05:00', canal: 'nota', descripcion: 'Nota en la puerta', adjuntos: [foto('nota.jpg')] }, NOW));
  assert.doesNotMatch(buildTextReport(propio, { generadoEn: NOW }), /-12\.04|maps\.google|Samsung/);
  assert.doesNotMatch(buildHtmlReport(propio, { generadoEn: NOW }), /-12\.04|maps\.google|Samsung/);
});

test('el informe muestra los datos corregidos, qué decía antes y montos en dólares', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-12T20:30:00-05:00', canal: 'whatsapp', contacto: '987654321', mensaje: 'Paga', montoExigido: '5000', cuentaPago: '912345678' }, NOW));
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: log[0].id, descripcion: 'Era en dólares', corrige: { montoExigido: '$ 800', medioPago: 'plin' } }, new Date('2026-10-13T15:00:00Z')));
  const text = buildTextReport(log, { generadoEn: NOW });
  assert.match(text, /Monto más alto exigido en dólares: US\$ 800\.00/);
  assert.doesNotMatch(text, /Monto más alto exigido: S\//);
  assert.match(text, /Monto exigido: US\$ 800\.00 \(dato corregido el 13\/10\/2026[^;]*; antes decía: Monto exigido: S\/ 5,000\.00; Moneda: Soles \(S\/\)\)/);
  assert.match(text, /Pago indicado: Plin 912345678 \(dato corregido el 13\/10\/2026[^;]*; antes decía: sin indicar\)/);
  assert.match(text, /Corrección del 13\/10\/2026, [^\n]*?: Medio de pago: Plin; Monto exigido: US\$ 800\.00/);
  assert.match(text, /Nota del 13\/10\/2026, [^\n]*?: Era en dólares/);
  assert.match(text, /Plin: 912345678 \(1\)/);
  assert.match(text, /Huella [0-9a-f]{64}/);
  const html = buildHtmlReport(log, { generadoEn: NOW });
  assert.match(html, /US\$ 800\.00 \(dato corregido el/);
  assert.match(html, /<dt>Corrección \(/);
});

test('el informe nunca etiqueta una cuenta como "No indicaron"', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-12T20:30:00-05:00', canal: 'whatsapp', mensaje: 'Deposita en 19112345678012', cuentaPago: '191-12345678-0-12' }, NOW));
  const text = buildTextReport(log, { generadoEn: NOW });
  const html = buildHtmlReport(log, { generadoEn: NOW });
  assert.doesNotMatch(text + html, /No indicaron/);
  assert.match(text, /Pago indicado: 191-12345678-0-12/);
  assert.match(text, /- 191-12345678-0-12 · Cuenta indicada · 1 vez\/veces · [^\n]* · origen: cuenta indicada para pagar, texto del mensaje/);
  assert.match(text, /Cuenta: 191-12345678-0-12 \(1\)/);
});
