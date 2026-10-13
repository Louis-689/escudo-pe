import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, parseAmount, parseMoney, formatMoney, validateIncident, createEntry, appendEntry, verifyChain,
  canonicalJson, summarize, applyCorrections, describeCorrection, claveCuenta, etiquetaMedio, GENESIS,
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

test('la validación no acepta propiedades heredadas como canal o medio de pago', () => {
  assert.match(validateIncident({ ...base, canal: 'constructor' }, NOW).join(' '), /Elige cómo/);
  assert.match(validateIncident({ ...base, medioPago: 'toString' }, NOW).join(' '), /Medio de pago/);
});

test('parseMoney reconoce dólares y soles', () => {
  assert.deepEqual(parseMoney('$ 500'), { monto: 500, moneda: 'USD' });
  assert.deepEqual(parseMoney('US$ 1,200'), { monto: 1200, moneda: 'USD' });
  assert.deepEqual(parseMoney('300 dólares'), { monto: 300, moneda: 'USD' });
  assert.deepEqual(parseMoney('2 mil dolares'), { monto: 2000, moneda: 'USD' });
  assert.deepEqual(parseMoney('USD 50'), { monto: 50, moneda: 'USD' });
  assert.deepEqual(parseMoney('S/ 500'), { monto: 500, moneda: 'PEN' });
  assert.deepEqual(parseMoney('500 lucas'), { monto: 500, moneda: 'PEN' });
  assert.deepEqual(parseMoney('3 mil soles'), { monto: 3000, moneda: 'PEN' });
  assert.deepEqual(parseMoney('1500'), { monto: 1500, moneda: 'PEN' });
  assert.deepEqual(parseMoney(''), { monto: null, moneda: 'PEN' });
  assert.deepEqual(parseMoney('100', 'USD'), { monto: 100, moneda: 'USD' });
  assert.deepEqual(parseMoney('S/ 100', 'USD'), { monto: 100, moneda: 'PEN' });
  assert.ok(Number.isNaN(parseMoney('$').monto));
  assert.ok(Number.isNaN(parseMoney('S/ 100 o $ 30').monto));
  // parseAmount sigue devolviendo solo el número.
  assert.equal(parseAmount('$ 500'), 500);
  assert.equal(parseAmount('500 lucas'), 500);
});

test('formatMoney imprime la moneda', () => {
  assert.equal(formatMoney(1500), 'S/ 1,500.00');
  assert.equal(formatMoney(1500, 'PEN'), 'S/ 1,500.00');
  assert.equal(formatMoney(1500, 'USD'), 'US$ 1,500.00');
  assert.equal(formatMoney(null, 'USD'), '');
  assert.equal(formatMoney(NaN), '');
});

test('createEntry guarda la moneda solo si es en dólares', () => {
  const usd = createEntry({ ...base, montoExigido: '$ 300' }, NOW);
  assert.equal(usd.montoExigido, 300);
  assert.equal(usd.moneda, 'USD');
  const usd2 = createEntry({ ...base, montoExigido: '300', moneda: 'USD' }, NOW);
  assert.equal(usd2.moneda, 'USD');
  assert.ok(!('moneda' in createEntry({ ...base, montoExigido: 'S/ 300' }, NOW)));
  assert.ok(!('moneda' in createEntry({ ...base, montoExigido: '' , moneda: 'USD' }, NOW)));
  assert.match(validateIncident({ ...base, moneda: 'EUR' }, NOW).join(' '), /Moneda no válida/);
});

test('los registros de versiones anteriores dan la misma huella', () => {
  const input = { ...base, id: 'abc', contacto: '987654321', montoExigido: '500', medioPago: 'yape', cuentaPago: '912345678' };
  const old = {
    id: 'abc', tipo: 'incidente', registradoEn: NOW.toISOString(), descripcion: '', ocurridoEn: '2026-10-13T01:30:00.000Z',
    canal: 'whatsapp', contacto: '+51 987 654 321', montoExigido: 500, medioPago: 'yape', cuentaPago: '912345678',
    mensaje: 'Paga o ya sabes', adjuntos: [],
  };
  assert.equal(canonicalJson(createEntry(input, NOW)), canonicalJson(old));
  const nota = { id: 'n1', tipo: 'nota', registradoEn: NOW.toISOString(), descripcion: 'texto', refiereA: 'abc' };
  assert.equal(canonicalJson(createEntry({ tipo: 'nota', id: 'n1', refiereA: 'abc', descripcion: 'texto' }, NOW)), canonicalJson(nota));
});

test('validateIncident revisa las correcciones estructuradas de una nota', () => {
  const nota = { tipo: 'nota', refiereA: 'x' };
  assert.deepEqual(validateIncident({ ...nota, corrige: { cuentaPago: '912000111' } }, NOW), [], 'una corrección puede ir sin texto');
  assert.deepEqual(validateIncident({ ...nota, corrige: { montoExigido: '$ 800', moneda: 'USD', medioPago: 'plin', contacto: '', titularCuenta: 'Ana' } }, NOW), []);
  assert.match(validateIncident({ ...nota, corrige: { canal: 'sms' } }, NOW).join(' '), /No se puede corregir el dato "canal"/);
  assert.match(validateIncident({ ...nota, corrige: { cuentaPago: 123 } }, NOW).join(' '), /debe ser texto/);
  assert.match(validateIncident({ ...nota, corrige: { montoExigido: 'mucho' } }, NOW).join(' '), /monto corregido/);
  assert.match(validateIncident({ ...nota, corrige: { montoExigido: '-5' } }, NOW).join(' '), /monto/);
  assert.match(validateIncident({ ...nota, corrige: { medioPago: 'toString' } }, NOW).join(' '), /Medio de pago/);
  assert.match(validateIncident({ ...nota, corrige: { moneda: 'EUR' } }, NOW).join(' '), /Moneda no válida/);
  assert.match(validateIncident({ ...nota, corrige: 'cuenta 123' }, NOW).join(' '), /corrección no es válida/);
  assert.match(validateIncident({ ...nota, corrige: [] }, NOW).join(' '), /corrección no es válida/);
  assert.match(validateIncident({ ...nota, corrige: {} }, NOW).join(' '), /Escribe el contenido/);
  assert.match(validateIncident({ ...nota, corrige: JSON.parse('{"__proto__": "x"}') }, NOW).join(' '), /No se puede corregir/);
});

test('createEntry normaliza la corrección como el formulario', () => {
  const n = createEntry({ tipo: 'nota', refiereA: 'x', descripcion: 'Me equivoqué', corrige: { contacto: '987111222', montoExigido: '$ 800', cuentaPago: ' 191-123 ' } }, NOW);
  assert.deepEqual(n.corrige, { contacto: '+51 987 111 222', montoExigido: 800, moneda: 'USD', cuentaPago: '191-123' });
  const sinMoneda = createEntry({ tipo: 'nota', refiereA: 'x', corrige: { montoExigido: '900' } }, NOW);
  assert.deepEqual(sinMoneda.corrige, { montoExigido: 900 }, 'un número solo mantiene la moneda del registro');
  assert.equal(sinMoneda.descripcion, '');
  assert.ok(!('corrige' in createEntry({ tipo: 'nota', refiereA: 'x', descripcion: 'hola' }, NOW)));
});

async function correctedLog() {
  let log = [];
  log = await appendEntry(log, createEntry({ ...base, contacto: '987654321', montoExigido: '5000', medioPago: 'yape', cuentaPago: '912345678' }, NOW));
  const id = log[0].id;
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: id, corrige: { cuentaPago: '912000111', montoExigido: '$ 800' } }, new Date('2026-10-13T13:00:00Z')));
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: id, descripcion: 'Era Plin', corrige: { medioPago: 'plin', cuentaPago: '912000222' } }, new Date('2026-10-13T14:00:00Z')));
  return log;
}

test('applyCorrections aplica las notas sin tocar los registros originales', async () => {
  const log = await correctedLog();
  const original = structuredClone(log);
  const fixed = applyCorrections(log);
  const e = fixed[0];
  assert.equal(e.cuentaPago, '912000222', 'la última corrección gana');
  assert.equal(e.medioPago, 'plin');
  assert.equal(e.montoExigido, 800);
  assert.equal(e.moneda, 'USD');
  assert.deepEqual(e.corregido.cuentaPago, { fecha: '2026-10-13T14:00:00.000Z', anterior: '912345678' });
  assert.deepEqual(e.corregido.montoExigido, { fecha: '2026-10-13T13:00:00.000Z', anterior: 5000 });
  assert.deepEqual(e.corregido.moneda, { fecha: '2026-10-13T13:00:00.000Z', anterior: 'PEN' });
  assert.equal(e.huella, log[0].huella);
  assert.deepEqual(log, original, 'la bitácora original no cambia');
  assert.deepEqual(await verifyChain(log), { ok: true, rotoEn: -1 });
  assert.deepEqual(applyCorrections(fixed), fixed, 'aplicar dos veces da lo mismo');
});

test('applyCorrections vuelve a soles y descarta valores manipulados', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({ ...base, montoExigido: 'US$ 100' }, NOW));
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: log[0].id, corrige: { moneda: 'PEN' } }, NOW));
  const e = applyCorrections(log)[0];
  assert.ok(!('moneda' in e));
  assert.equal(e.montoExigido, 100);
  // Una nota importada con valores que la validación no habría aceptado no cambia nada.
  log = await appendEntry(log, { id: 'z', tipo: 'nota', refiereA: log[0].id, registradoEn: NOW.toISOString(), descripcion: '', corrige: { montoExigido: 'abc', medioPago: 'toString', moneda: 'EUR', canal: 'sms' } });
  const e2 = applyCorrections(log)[0];
  assert.equal(e2.montoExigido, 100);
  assert.equal(e2.medioPago, '');
  assert.equal(e2.canal, 'whatsapp');
  assert.equal(applyCorrections([]).length, 0);
});

test('describeCorrection resume lo corregido', () => {
  assert.equal(describeCorrection({ montoExigido: 800, moneda: 'USD', medioPago: 'plin' }), 'Medio de pago: Plin; Monto exigido: US$ 800.00');
  assert.equal(describeCorrection({ contacto: '' }), 'Número o perfil que contactó: (sin dato)');
  assert.equal(describeCorrection({ moneda: 'USD' }), 'Moneda: Dólares (US$)');
});

test('summarize usa los datos corregidos y separa soles de dólares', async () => {
  let log = await correctedLog();
  log = await appendEntry(log, createEntry({ ...base, montoExigido: '1500', cuentaPago: '912-000-222' }, NOW));
  log = await appendEntry(log, createEntry({ ...base, montoExigido: '$ 200' }, NOW));
  const s = summarize(log);
  assert.equal(s.montoMaximo, 1500);
  assert.equal(s.montoMaximoUSD, 800);
  assert.deepEqual(s.cuentas, [{ valor: 'Plin: 912000222', veces: 2 }], 'la misma cuenta escrita distinto es una sola');
  const soloSoles = summarize(await buildLog());
  assert.ok(!('montoMaximoUSD' in soloSoles));
});

test('una cuenta sin medio de pago se llama "Cuenta", nunca "No indicaron"', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({ ...base, cuentaPago: '191-12345678-0-12' }, NOW));
  assert.deepEqual(summarize(log).cuentas, [{ valor: 'Cuenta: 191-12345678-0-12', veces: 1 }]);
  assert.equal(etiquetaMedio(''), 'Cuenta');
  assert.equal(etiquetaMedio('otro'), 'Cuenta');
  assert.equal(etiquetaMedio('yape'), 'Yape');
  assert.equal(etiquetaMedio('toString'), 'Cuenta');
});

test('claveCuenta junta la misma cuenta escrita de distintas formas', () => {
  assert.equal(claveCuenta('191-12345678-0-12'), claveCuenta('19112345678012'));
  assert.equal(claveCuenta('912 345 678'), claveCuenta('+51912345678'));
  assert.equal(claveCuenta('Yape 912345678'), '51912345678');
  assert.equal(claveCuenta('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), 'tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t');
});

test('createEntry conserva las huellas de chat válidas y nada más', () => {
  const inc = { ocurridoEn: '2026-10-12T20:30:00-05:00', canal: 'whatsapp', contacto: '987654321', mensaje: 'x' };
  const e = createEntry({ ...inc, huellasChat: ['0123456789abcdef', 'malo', 5] }, NOW);
  assert.deepEqual(e.huellasChat, ['0123456789abcdef']);
  const sin = createEntry(inc, NOW);
  assert.equal('huellasChat' in sin, false);
});

// Pago ya hecho ("Ya pagué, aunque sea una parte").
const pagoForm = { monto: 'S/ 500', fecha: '2026-10-02T10:15:00-05:00', medio: 'yape', cuenta: ' 912 345 678 ', operacion: ' 12345678 ' };

test('createEntry guarda el pago ya hecho con su forma fija', () => {
  const e = createEntry({ ...base, pago: pagoForm }, NOW);
  assert.deepEqual(e.pago, { monto: 500, fecha: '2026-10-02T15:15:00.000Z', medio: 'yape', cuenta: '912 345 678', operacion: '12345678' });
  const usd = createEntry({ ...base, pago: { ...pagoForm, monto: '$ 200', medio: '' } }, NOW);
  assert.deepEqual(usd.pago, { monto: 200, moneda: 'USD', fecha: '2026-10-02T15:15:00.000Z', medio: '', cuenta: '912 345 678', operacion: '12345678' });
  // Un valor de datetime-local (sin zona) se lee en la hora del celular, como ocurridoEn.
  const local = createEntry({ ...base, pago: { monto: '50', fecha: '2026-10-02T10:15' } }, NOW);
  assert.equal(local.pago.fecha, new Date('2026-10-02T10:15').toISOString());
  assert.equal(local.pago.cuenta, '');
  assert.equal(local.pago.operacion, '');
});

test('un bloque de pago vacío no se guarda ni cambia la huella', async () => {
  const input = { ...base, id: 'abc', contacto: '987654321', montoExigido: '500', medioPago: 'yape', cuentaPago: '912345678' };
  const old = {
    id: 'abc', tipo: 'incidente', registradoEn: NOW.toISOString(), descripcion: '', ocurridoEn: '2026-10-13T01:30:00.000Z',
    canal: 'whatsapp', contacto: '+51 987 654 321', montoExigido: 500, medioPago: 'yape', cuentaPago: '912345678',
    mensaje: 'Paga o ya sabes', adjuntos: [],
  };
  const vacio = { monto: '', fecha: '', medio: '', cuenta: '  ', operacion: '' };
  for (const pago of [undefined, null, vacio]) {
    const e = createEntry({ ...input, pago }, NOW);
    assert.ok(!('pago' in e));
    assert.equal(canonicalJson(e), canonicalJson(old));
    assert.equal((await appendEntry([], e))[0].huella, (await appendEntry([], old))[0].huella);
  }
  assert.deepEqual(validateIncident({ ...base, pago: vacio }, NOW), []);
});

test('la cadena se verifica con registros con y sin pago', async () => {
  let log = await buildLog();
  log = await appendEntry(log, createEntry({ ...base, pago: pagoForm }, NOW));
  assert.deepEqual(await verifyChain(log), { ok: true, rotoEn: -1 });
  const alterado = structuredClone(log);
  alterado[3].pago.monto = 5;
  assert.deepEqual(await verifyChain(alterado), { ok: false, rotoEn: 3 });
});

test('validateIncident revisa el pago', () => {
  const v = (pago, extra = {}) => validateIncident({ ...base, ...extra, pago }, NOW).join(' ');
  assert.equal(v(pagoForm), '');
  assert.match(v({ ...pagoForm, monto: '' }), /Indica cuánto pagaste/);
  assert.match(v({ ...pagoForm, monto: 'mucho' }), /No se entiende el monto pagado/);
  assert.match(v({ ...pagoForm, monto: '0' }), /mayor que cero/);
  assert.match(v({ ...pagoForm, monto: '$' }), /No se entiende el monto pagado/);
  assert.match(v({ ...pagoForm, fecha: '' }), /fecha y hora del pago/);
  assert.match(v({ ...pagoForm, fecha: 'ayer' }), /fecha y hora del pago/);
  assert.match(v({ ...pagoForm, fecha: '1999-12-31T10:00:00Z' }), /fecha y hora del pago/);
  assert.match(v({ ...pagoForm, fecha: '2026-10-14T10:00:00-05:00' }), /pago no puede estar en el futuro/);
  assert.equal(v({ ...pagoForm, fecha: '2026-10-13T12:05:00Z' }), '', 'margen para relojes desajustados');
  assert.match(v({ ...pagoForm, medio: 'bitcoin' }), /Medio del pago no válido/);
  assert.match(v({ ...pagoForm, medio: 'toString' }), /Medio del pago no válido/);
  assert.match(v({ ...pagoForm, cuenta: '1'.repeat(81) }), /máximo 80/);
  assert.match(v({ ...pagoForm, operacion: '9'.repeat(61) }), /máximo 60/);
  assert.match(v('pagué 500'), /datos del pago no son válidos/);
  assert.match(v([]), /datos del pago no son válidos/);
  // Elegir solo el medio ya es empezar a llenar el bloque.
  assert.match(v({ medio: 'yape' }), /Indica cuánto pagaste.*fecha y hora del pago/);
});

test('un pago anotado basta como contenido del registro', () => {
  const soloPago = { ocurridoEn: base.ocurridoEn, canal: 'whatsapp', pago: pagoForm };
  assert.deepEqual(validateIncident(soloPago, NOW), []);
  assert.match(validateIncident({ ...soloPago, pago: { monto: '' } }, NOW).join(' '), /Copia el mensaje/);
});

test('el pago no se corrige con una nota estructurada y applyCorrections lo conserva', async () => {
  assert.match(validateIncident({ tipo: 'nota', refiereA: 'x', corrige: { pago: '600' } }, NOW).join(' '), /No se puede corregir el dato "pago"/);
  let log = [];
  log = await appendEntry(log, createEntry({ ...base, cuentaPago: '912345678', pago: pagoForm }, NOW));
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: log[0].id, corrige: { cuentaPago: '912000111' } }, NOW));
  // Una nota importada que intenta cambiar el pago no tiene efecto.
  log = await appendEntry(log, { id: 'z', tipo: 'nota', refiereA: log[0].id, registradoEn: NOW.toISOString(), descripcion: '', corrige: { pago: { monto: 1 } } });
  const e = applyCorrections(log)[0];
  assert.equal(e.cuentaPago, '912000111');
  assert.deepEqual(e.pago, log[0].pago);
});

test('summarize suma lo pagado por moneda solo si hay pagos', async () => {
  let log = await buildLog();
  const sinPagos = summarize(log);
  assert.ok(!('totalPagado' in sinPagos));
  assert.ok(!('totalPagadoUSD' in sinPagos));
  log = await appendEntry(log, createEntry({ ...base, pago: { ...pagoForm, monto: '300.10' } }, NOW));
  log = await appendEntry(log, createEntry({ ...base, pago: { ...pagoForm, monto: '200.20' } }, NOW));
  let s = summarize(log);
  assert.equal(s.totalPagado, 500.3);
  assert.ok(!('totalPagadoUSD' in s));
  log = await appendEntry(log, createEntry({ ...base, pago: { ...pagoForm, monto: 'US$ 150' } }, NOW));
  // Un pago importado con forma rara no se suma.
  log = await appendEntry(log, { ...createEntry(base, NOW), pago: { monto: 'mil' } });
  s = summarize(log);
  assert.equal(s.totalPagado, 500.3);
  assert.equal(s.totalPagadoUSD, 150);
  assert.equal(s.totalIncidentes, 6);
});
