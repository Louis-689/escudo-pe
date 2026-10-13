import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextLimaTime,
  normalizeContact, mapsLink, sosMessage, tripMessage, arrivalMessage, whatsappLink, smsLink, PLAN, BLINDAJE,
} from '../js/core/safety.js';
import { Vault } from '../js/core/vault.js';
import { MemoryStorage } from '../js/core/storage.js';

const AHORA = new Date('2026-10-13T20:00:00-05:00');
const UBI = { lat: -12.0464, lon: -77.0428, precision: 25 };

test('normalizeContact valida nombre y número', () => {
  assert.deepEqual(normalizeContact({ nombre: ' Mamá ', numero: '987 654 321' }), { nombre: 'Mamá', numero: '+51987654321' });
  assert.deepEqual(normalizeContact({ nombre: 'Tío', numero: '+1 305 555 0100' }).numero, '+13055550100');
  assert.throws(() => normalizeContact({ nombre: '', numero: '987654321' }), /nombre/);
  assert.throws(() => normalizeContact({ nombre: 'X', numero: '123' }), /no es válido/);
  // Un celular con un dígito de menos no se convierte en un número extranjero.
  assert.throws(() => normalizeContact({ nombre: 'X', numero: '987 654 32' }), /no es válido/);
  assert.throws(() => normalizeContact({ nombre: 'X', numero: '0987654321' }), /no es válido/);
  assert.throws(() => normalizeContact({ nombre: 'X', numero: '+0987654321' }), /no es válido/);
});

test('mensajes de SOS y de trayecto incluyen ubicación y hora de Lima', () => {
  assert.equal(mapsLink(-12.0464, -77.0428), 'https://maps.google.com/?q=-12.046400,-77.042800');
  const sos = sosMessage({ ubicacion: UBI, ahora: AHORA });
  assert.match(sos, /maps\.google\.com\/\?q=-12\.046400,-77\.042800 \(precisión aprox\. 25 m\)/);
  assert.match(sos, /Hora: 20:00\./);
  assert.match(sosMessage({ ahora: AHORA }), /No pude obtener mi ubicación/);

  const hasta = new Date('2026-10-13T21:30:00-05:00');
  const trip = tripMessage({ destino: 'el mercado de Caquetá', motivo: 'reunión', hasta, ubicacion: UBI, ahora: AHORA });
  assert.match(trip, /voy a el mercado de Caquetá \(reunión\)/);
  assert.match(trip, /antes de las 21:30, llámame/);
  assert.throws(() => tripMessage({ destino: '', hasta, ahora: AHORA }), /a dónde/);
  assert.throws(() => tripMessage({ destino: 'x', hasta: AHORA, ahora: AHORA }), /más tarde/);
  assert.match(arrivalMessage({ ahora: AHORA }), /Llegué bien/);
});

test('enlaces de WhatsApp y SMS', () => {
  assert.equal(whatsappLink('+51987654321', 'hola mundo'), 'https://wa.me/51987654321?text=hola%20mundo');
  assert.equal(smsLink(['+51987654321', '+51911111111'], 'a&b'), 'sms:+51987654321,+51911111111?&body=a%26b');
});

test('el plan tiene identificadores únicos y el blindaje tiene pasos', () => {
  const ids = PLAN.flatMap((s) => s.items.map(([id]) => id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(BLINDAJE.every((b) => b.pasos.length > 0));
});

test('el plan se guarda cifrado, viaja en la copia y sobrevive al cambio de contraseña', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', { iterations: 1000 });
  assert.deepEqual(await v.getPlan(), { hechos: {}, palabraClave: '', notas: '' });
  await v.savePlan({ hechos: { clave: true }, palabraClave: 'girasol azul', notas: '' });
  assert.ok(!JSON.stringify([...storage.map.values()]).includes('girasol'));
  await v.changePassword('otra-clave');
  const reopened = await Vault.open(storage, 'otra-clave');
  assert.equal((await reopened.getPlan()).palabraClave, 'girasol azul');
  const restored = await Vault.importBackup(new MemoryStorage(), await reopened.exportBackup(), 'otra-clave');
  assert.deepEqual((await restored.getPlan()).hechos, { clave: true });
});

test('nextLimaTime usa la hora de Lima sin importar la zona del celular', () => {
  const now = new Date('2026-10-13T01:49:00Z'); // 20:49 del 12/10 en Lima
  assert.equal(nextLimaTime('23:59', now).toISOString(), '2026-10-13T04:59:00.000Z');
  assert.equal(nextLimaTime('08:00', now).toISOString(), '2026-10-13T13:00:00.000Z');
  assert.throws(() => nextLimaTime('20:00', now), /ya pasó/);
  const msg = tripMessage({ destino: 'x', hasta: nextLimaTime('08:00', now), ahora: now });
  assert.match(msg, /antes de las 08:00 de mañana/);
  assert.throws(() => nextLimaTime('25:00', now), /hora límite/);
  assert.throws(() => nextLimaTime('', now), /hora límite/);
});
