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
  assert.deepEqual(r.cuentas, [{ valor: '+51912345678', digitos: '51912345678', tipo: 'Billetera vinculada a celular', medio: 'yape' }]);
  assert.equal(extractIndicators('llámame al 912 345 678').cuentas.length, 0);
});

test('reconoce celulares con 51 sin "+" y nunca los toma por cuentas', () => {
  const r = extractIndicators('Llama al 51987654321 o al 51 912 345 678');
  assert.deepEqual(r.telefonos.map((t) => t.valor), ['+51987654321', '+51912345678']);
  assert.deepEqual(r.cuentas, []);
});

test('los enlaces de WhatsApp con número son teléfonos, no cuentas', () => {
  const r = extractIndicators('Escríbeme: https://wa.me/51987654321 o api.whatsapp.com/send?phone=51912345678&text=hola y wa.me/987111222');
  assert.deepEqual(r.telefonos.map((t) => t.valor), ['+51987654321', '+51912345678', '+51987111222']);
  assert.deepEqual(r.cuentas, []);
  assert.equal(r.enlaces.length, 3);
  assert.equal(extractIndicators('https://api.whatsapp.com/send/?phone=584125551234').telefonos[0].pais, 'Venezuela');
});

test('los dígitos dentro de un enlace no son cuentas ni teléfonos', () => {
  const r = extractIndicators('mira https://bit.ly/1234567890123 y https://ejemplo.com/p/987654321');
  assert.deepEqual(r.cuentas, []);
  assert.deepEqual(r.telefonos, []);
});

test('una cuenta que se superpone con un teléfono no se reporta (aunque empiece antes)', () => {
  assert.deepEqual(extractIndicators('Llama al 12 987 654 321').cuentas, []);
  const r = extractIndicators('Deposita en 191-12345678-0-12 o llama al +51 987 654 321');
  assert.deepEqual(r.cuentas.map((c) => c.valor), ['191-12345678-0-12']);
  assert.deepEqual(r.telefonos.map((t) => t.valor), ['+51987654321']);
});

test('consolidate junta la cuenta del campo y la del texto en una fila con el medio más específico', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-10T09:00:00-05:00', canal: 'whatsapp', mensaje: 'Deposita en 19112345678012', cuentaPago: '191-12345678-0-12' }, NOW));
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-11T09:00:00-05:00', canal: 'whatsapp', mensaje: 'Yapea al 912 345 678', cuentaPago: '912345678', titularCuenta: 'Jua* Pér*' }, NOW));
  const c = consolidate(log);
  assert.equal(c.cuentas.length, 2);
  const banco = c.cuentas.find((x) => x.valor === '191-12345678-0-12');
  assert.deepEqual(banco.origenes, ['cuenta de pago', 'mensaje']);
  assert.equal(banco.veces, 1, 'cuenta incidentes, no menciones');
  assert.equal(banco.medio, '');
  const yape = c.cuentas.find((x) => x.valor === '912345678');
  assert.equal(yape.medio, 'yape');
  assert.equal(yape.titular, 'Jua* Pér*');
  assert.equal(yape.tipo, 'Billetera vinculada a celular');
});

test('consolidate usa los datos corregidos por las notas', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-10T09:00:00-05:00', canal: 'llamada', contacto: '987654321', descripcion: 'Llamó', cuentaPago: '912345678' }, NOW));
  log = await appendEntry(log, createEntry({ tipo: 'nota', refiereA: log[0].id, corrige: { contacto: '912000111', cuentaPago: '191-000' } }, NOW));
  const c = consolidate(log);
  assert.deepEqual(c.telefonos.map((t) => [t.valor, t.origenes]), [['+51912000111', ['contacto']]]);
  assert.deepEqual(c.cuentas.map((x) => x.valor), ['191-000']);
});

test('el mismo número como contacto y en el texto cuenta una sola vez por incidente', async () => {
  let log = [];
  log = await appendEntry(log, createEntry({ ocurridoEn: '2026-10-10T09:00:00-05:00', canal: 'whatsapp', contacto: '987654321', mensaje: 'Soy el 987 654 321, guárdame' }, NOW));
  const t = consolidate(log).telefonos;
  assert.equal(t.length, 1);
  assert.equal(t[0].veces, 1);
  assert.deepEqual(t[0].origenes, ['contacto', 'mensaje']);
});
