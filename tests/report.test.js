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
