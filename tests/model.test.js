import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, parseAmount, validateIncident, createEntry, appendEntry, verifyChain,
  canonicalJson, summarize, GENESIS,
} from '../js/core/model.js';

const NOW = new Date('2026-10-13T12:00:00Z');
const base = { ocurridoEn: '2026-10-12T20:30:00-05:00', canal: 'whatsapp', mensaje: 'Paga o ya sabes' };

test('normalizePhone reconoce celulares peruanos en varios formatos', () => {
  for (const raw of ['987654321', '987 654 321', '+51 987-654-321', '51987654321']) {
    assert.deepEqual(normalizePhone(raw), { valor: '+51 987 654 321', esCelularPeru: true });
  }
});

test('normalizePhone deja intactos textos que no son teléfonos', () => {
  assert.deepEqual(normalizePhone('facebook.com/el.cobrador'), { valor: 'facebook.com/el.cobrador', esCelularPeru: false });
  assert.deepEqual(normalizePhone(''), { valor: '', esCelularPeru: false });
  assert.equal(normalizePhone('+57 300 123 4567').valor, '+573001234567');
});

test('parseAmount entiende cómo se escriben los montos en el Perú', () => {
  assert.equal(parseAmount('S/ 1,500.50'), 1500.5);
  assert.equal(parseAmount('1500'), 1500);
  assert.equal(parseAmount('1.500'), 1500);
  assert.equal(parseAmount('1,500'), 1500);
  assert.equal(parseAmount('25,50'), 25.5);
  assert.equal(parseAmount('2 mil'), 2000);
  assert.equal(parseAmount('50 soles'), 50);
  assert.equal(parseAmount('1.234.567,89'), 1234567.89);
  assert.equal(parseAmount(''), null);
  assert.ok(Number.isNaN(parseAmount('muchísimo')));
});

test('validateIncident exige fecha, canal y algún contenido', () => {
  assert.deepEqual(validateIncident(base, NOW), []);
  const errors = validateIncident({ canal: 'x' }, NOW);
  assert.equal(errors.length, 3);
});

test('validateIncident rechaza fechas futuras y montos raros', () => {
  assert.match(validateIncident({ ...base, ocurridoEn: '2026-12-01T00:00:00Z' }, NOW)[0], /futuro/);
  assert.match(validateIncident({ ...base, montoExigido: 'abc' }, NOW)[0], /monto/);
});

test('createEntry normaliza datos', () => {
  const e = createEntry({ ...base, contacto: '987654321', montoExigido: 'S/ 3,000', medioPago: 'yape', cuentaPago: ' 912345678 ' }, NOW);
  assert.equal(e.contacto, '+51 987 654 321');
  assert.equal(e.montoExigido, 3000);
  assert.equal(e.cuentaPago, '912345678');
  assert.equal(e.registradoEn, NOW.toISOString());
  assert.equal(e.ocurridoEn, '2026-10-13T01:30:00.000Z');
});

test('createEntry lanza error con la lista de problemas', () => {
  assert.throws(() => createEntry({}, NOW), (err) => err.errors.length > 0);
});

test('canonicalJson no depende del orden de las claves', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

async function buildLog() {
  let log = [];
  log = await appendEntry(log, createEntry({ ...base, contacto: '987654321', montoExigido: '5000' }, NOW));
  log = await appendEntry(log, createEntry({ ...base, ocurridoEn: '2026-10-11T10:00:00-05:00', canal: 'llamada', contacto: '987654321', montoExigido: '3000', medioPago: 'yape', cuentaPago: '912345678' }, NOW));
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: log[0].id, descripcion: 'El monto real era 6000' }, NOW));
  return log;
}

test('la cadena de huellas se verifica correctamente', async () => {
  const log = await buildLog();
  assert.equal(log[0].huellaPrevia, GENESIS);
  assert.equal(log[1].huellaPrevia, log[0].huella);
  assert.deepEqual(await verifyChain(log), { ok: true, rotoEn: -1 });
});

test('editar un registro rompe la cadena', async () => {
  const log = await buildLog();
  log[1] = { ...log[1], montoExigido: 1 };
  assert.deepEqual(await verifyChain(log), { ok: false, rotoEn: 1 });
});

test('borrar o reordenar registros rompe la cadena', async () => {
  const log = await buildLog();
  assert.equal((await verifyChain([log[0], log[2]])).ok, false);
  assert.equal((await verifyChain([log[1], log[0], log[2]])).rotoEn, 0);
});

test('summarize agrupa números y cuentas repetidas', async () => {
  const s = summarize(await buildLog());
  assert.equal(s.totalIncidentes, 2);
  assert.equal(s.totalNotas, 1);
  assert.equal(s.montoMaximo, 5000);
  assert.deepEqual(s.contactos, [{ valor: '+51 987 654 321', veces: 2 }]);
  assert.deepEqual(s.cuentas, [{ valor: 'Yape: 912345678', veces: 1 }]);
  assert.equal(s.primerIncidente, '2026-10-11T15:00:00.000Z');
});
