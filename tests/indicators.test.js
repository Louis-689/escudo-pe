import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPhone, extractIndicators, consolidate, countryOf } from '../js/core/indicators.js';
import { appendEntry, createEntry } from '../js/core/model.js';

const NOW = new Date('2026-10-13T12:00:00Z');

test('classifyPhone reconoce celulares, fijos y números extranjeros', () => {
  assert.deepEqual(classifyPhone('987 654 321'), { e164: '+51987654321', pais: 'Perú', tipo: 'Celular' });
  assert.deepEqual(classifyPhone('+51 987-654-321'), { e164: '+51987654321', pais: 'Perú', tipo: 'Celular' });
  assert.equal(classifyPhone('+58 412 555 1234').pais, 'Venezuela');
  assert.equal(classifyPhone('+593 99 123 4567').pais, 'Ecuador');
  assert.equal(classifyPhone('0057 300 123 4567').pais, 'Colombia');
  assert.equal(classifyPhone('01 4567890').tipo, 'Fijo (Lima)');
  assert.equal(classifyPhone('hola'), null);
  assert.equal(classifyPhone('12345'), null);
});

test('countryOf prefiere el código más largo', () => {
  assert.equal(countryOf('593991234567'), 'Ecuador');
  assert.equal(countryOf('51987654321'), 'Perú');
});

test('extractIndicators encuentra datos típicos de un mensaje extorsivo', () => {
  const msg = `Somos los de la zona. Deposita S/ 5,000 al yape 912 345 678 o a la cuenta BCP 191-12345678-0-12.
CCI 00219100123456780123. Si no, +58 412 555 1234 te visita. Mira https://bit.ly/abc123 y sigue a @loscobradores.
Escribe a cobros@mail.com. La moto 1234-AB y el carro ABC-123 ya saben dónde estudian tus hijos.
USDT: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t 24 horas o plomo.`;
  const r = extractIndicators(msg);
  assert.deepEqual(r.telefonos.map((t) => t.valor), ['+51912345678', '+584125551234']);
  assert.deepEqual(r.cuentas.map((c) => c.tipo), ['Billetera vinculada a celular', 'Posible cuenta bancaria', 'CCI (cuenta interbancaria)']);
  assert.deepEqual(r.enlaces.map((x) => x.valor), ['https://bit.ly/abc123']);
  assert.deepEqual(r.perfiles.map((x) => x.valor), ['@loscobradores']);
  assert.deepEqual(r.correos.map((x) => x.valor), ['cobros@mail.com']);
  assert.deepEqual(r.placas.map((x) => x.valor), ['1234-AB', 'ABC-123']);
  assert.equal(r.billeteras[0].red, 'TRON (USDT TRC-20)');
  assert.ok(r.montos.some((m) => m.valor.startsWith('S/ 5,000')));
  assert.deepEqual(r.riesgos.map((x) => x.valor).sort(), ['familia', 'muerte', 'plazo', 'vigilancia']);
  assert.deepEqual(r.mediosPago.map((x) => x.valor), ['yape', 'bcp', 'usdt']);
});

test('extractIndicators con texto vacío', () => {
  assert.deepEqual(extractIndicators('').telefonos, []);
});

test('consolidate agrupa por número y cuenta con fechas y canales', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-10T09:00:00-05:00', canal: 'llamada', contacto: '987654321', descripcion: 'Llamó pidiendo cupo' }, NOW));
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-12T21:00:00-05:00', canal: 'whatsapp', contacto: '+51 987 654 321', mensaje: 'Yapea al 912345678 hoy mismo', medioPago: 'yape', cuentaPago: '912345678' }, NOW));
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: log[0].id, descripcion: 'nada' }, NOW));
  const c = consolidate(log);
  const main = c.telefonos.find((t) => t.valor === '+51987654321');
  assert.equal(main.veces, 2);
  assert.deepEqual(main.canales, ['llamada', 'whatsapp']);
  assert.equal(main.primera, '2026-10-10T14:00:00.000Z');
  assert.equal(main.ultima, '2026-10-13T02:00:00.000Z');
  assert.ok(c.telefonos.some((t) => t.valor === '+51912345678'));
  assert.equal(c.cuentas[0].medio, 'yape');
  assert.deepEqual(c.riesgos.map((r) => r.valor), ['plazo']);
});

test('un número después de "yapea al" también cuenta como billetera', () => {
  const r = extractIndicators('Tiene hasta mañana para yapear 3 mil al 912 345 678');
  assert.deepEqual(r.cuentas, [{ valor: '+51912345678', digitos: '+51912345678', tipo: 'Billetera vinculada a celular', medio: 'yape' }]);
  assert.equal(extractIndicators('llámame al 912 345 678').cuentas.length, 0);
});
