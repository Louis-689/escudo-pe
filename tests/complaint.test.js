import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vault } from '../js/core/vault.js';
import { MemoryStorage } from '../js/core/storage.js';
import {
  buildComplaintText, buildComplaintBody, buildPoliceComplaintText, buildBankReportText, extortionAccounts,
} from '../js/core/complaint.js';
import { appendEntry, createEntry } from '../js/core/model.js';

const NOW = new Date('2026-10-13T12:00:00-05:00');

async function sampleLog() {
  const vault = await Vault.create(new MemoryStorage(), 'clave larga 123');
  const photo = new Uint8Array(readFileSync(new URL('./fixtures/foto-gps.jpg', import.meta.url)));
  await vault.add({
    ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'whatsapp', contacto: '987654321',
    mensaje: 'Paga 5 mil o tu familia <b>sufre</b>', montoExigido: '5 mil', medioPago: 'yape', cuentaPago: '912345678', titularCuenta: 'Jua* Pér*',
  }, [{ nombre: 'casa.jpg', tipo: 'image/jpeg', bytes: photo, recibida: true }], NOW);
  await vault.add({ ocurridoEn: '2026-10-10T08:00:00-05:00', canal: 'llamada', contacto: '+57 300 1234567', descripcion: 'Voz de hombre, acento extranjero' }, [], NOW);
  return vault.log;
}

test('la denuncia ordena los hechos y pide las diligencias que corresponden', async () => {
  const text = buildComplaintText(await sampleLog(), { nombre: 'Rosa Quispe', dni: '12345678', ciudad: 'Lima', reserva: true }, NOW);
  assert.match(text, /SEÑOR\(A\) FISCAL PROVINCIAL PENAL DE TURNO DE LIMA/);
  assert.match(text, /Rosa Quispe, identificado\(a\) con DNI 12345678/);
  assert.match(text, /art\. 326 del Código Procesal Penal/);
  assert.match(text, /usuarios de las líneas \+573001234567, \+51987654321/);
  // Hechos en orden cronológico.
  assert.ok(text.indexOf('10/10/2026') < text.indexOf('11/10/2026'));
  assert.match(text, /Me exigieron S\/ 5,000\.00, a pagar por Yape 912345678, cuyo titular, según muestra la aplicación, es "Jua\* Pér\*"/);
  assert.match(text, /levantamiento del secreto bancario \(art\. 235/);
  assert.match(text, /coordenadas GPS .*casa\.jpg: -11\.975033, -76\.987583/);
  assert.match(text, /el bloqueo de las líneas y de los equipos/);
  assert.match(text, /incluida la reserva de mi identidad/);
  assert.doesNotMatch(text, /undefined|null|NaN/);
});

test('sin datos personales deja espacios para llenar a mano', async () => {
  const text = buildComplaintText([], {}, NOW);
  assert.match(text, /____ ?, identificado\(a\) con DNI _+/);
  assert.match(text, /Describa aquí los hechos/);
  assert.doesNotMatch(text, /undefined|null|NaN|reserva de mi identidad/);
});

test('la versión HTML escapa el texto de terceros', async () => {
  const html = buildComplaintBody(await sampleLog(), { nombre: '<img src=x onerror=alert(1)>' }, NOW);
  assert.doesNotMatch(html, /<img|<b>sufre/);
  assert.match(html, /&lt;b&gt;sufre/);
});

test('la queja contra la inacción policial cita el art. 377', () => {
  const text = buildPoliceComplaintText({ nombre: 'Rosa Quispe', comisaria: 'Comisaría de Caquetá', fechaIntento: '12/10/2026' }, NOW);
  assert.match(text, /acudí a Comisaría de Caquetá/);
  assert.match(text, /art\. 377 del Código Penal/);
  assert.doesNotMatch(text, /undefined/);
});

test('no acusa a quien la víctima solo menciona ni usa el GPS de sus propias fotos', async () => {
  const vault = await Vault.create(new MemoryStorage(), 'clave larga 123');
  const photo = new Uint8Array(readFileSync(new URL('./fixtures/foto-gps.jpg', import.meta.url)));
  await vault.add({
    ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'presencial',
    descripcion: 'Dejaron una nota en mi puerta. Mi hijo (987111222) también recibió una llamada.',
  }, [{ nombre: 'nota-puerta.jpg', tipo: 'image/jpeg', bytes: photo }], NOW);
  await vault.add({ ocurridoEn: '2026-10-12T08:00:00-05:00', canal: 'whatsapp', contacto: '987654321', mensaje: 'Deposita al 912000111' }, [], NOW);
  const text = buildComplaintText(vault.log, {}, NOW);
  assert.doesNotMatch(text, /987111222.*(usuarios|titulares)|usuarios de las líneas[^\n]*\+51987111222/);
  assert.match(text, /usuarios de las líneas[^\n]*\+51987654321/);
  // Los números que solo aparecen en el texto no se acusan: se pide verificar de quién son.
  assert.doesNotMatch(text, /(usuarios|titulares|bloqueo|inmovilización)[^\n]*(912000111|987111222)/);
  assert.match(text, /Se verifique a quién pertenecen los siguientes números y cuentas mencionados en los mensajes: [^\n]*\+51912000111/);
  assert.match(text, /mencionados en los mensajes: [^\n]*\+51987111222/);
  assert.doesNotMatch(text, /coordenadas GPS/);
  assert.match(text, /una vez realizadas las diligencias de identificación/);
});

test('pide datos a WhatsApp, pericia de voz, bloqueo de IMEI y, si la víctima acepta, entrega vigilada', async () => {
  const vault = await Vault.create(new MemoryStorage(), 'clave larga 123');
  await vault.add({ ocurridoEn: '2026-10-12T08:00:00-05:00', canal: 'whatsapp', contacto: '987654321', mensaje: 'Paga o ya sabes' },
    [{ nombre: 'PTT-20261012-WA0001.opus', tipo: 'audio/ogg', bytes: new Uint8Array([1, 2, 3]) }], NOW);
  const text = buildComplaintText(vault.log, { operativo: true }, NOW);
  assert.match(text, /WhatsApp \(Meta Platforms\).*\+51 987 654 321/);
  assert.match(text, /pericia de identificación de voz sobre el audio/);
  assert.match(text, /IMEI .*RENTESEG/);
  assert.match(text, /entrega vigilada \(art\. 340/);
  assert.doesNotMatch(buildComplaintText(vault.log, {}, NOW), /entrega vigilada/);
});

test('el reporte al banco lista solo las cuentas del extorsionador, con el titular mostrado', async () => {
  const { buildBankReportText, extortionAccounts } = await import('../js/core/complaint.js');
  const log = await sampleLog();
  assert.equal(extortionAccounts(log).length, 1);
  const text = buildBankReportText(log, { nombre: 'Rosa Quispe', numeroDenuncia: '123-2026' }, NOW);
  assert.match(text, /Yape: 912345678 — titular que muestra la aplicación: Jua\* Pér\*/);
  assert.match(text, /carpeta fiscal: 123-2026/);
  assert.match(text, /UIF/);
  assert.doesNotMatch(text, /undefined|NaN/);
});

const at = (iso) => new Date(iso);

async function plainLog(...items) {
  let log = [];
  for (const [input, when = NOW] of items) {
    const refiereA = typeof input.refiereA === 'number' ? log[input.refiereA].id : input.refiereA;
    log = await appendEntry(log, createEntry({ ...input, ...(refiereA ? { refiereA } : {}) }, when));
  }
  return log;
}

test('solo el contacto y la cuenta de pago se denuncian; lo del texto solo se verifica', async () => {
  const log = await plainLog([{
    ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'whatsapp', contacto: '987654321', cuentaPago: '191-12345678-0-12',
    mensaje: 'Paga o ya sabes. Tu esposa está en 51 955 444 333 y su cuenta es 19400011122233. Yapea al 912000111. USDT TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  }]);
  const text = buildComplaintText(log, {}, NOW);
  const denunciados = text.slice(text.indexOf('I. PETITORIO'), text.indexOf('II. HECHOS'));
  assert.match(denunciados, /usuarios de las líneas \+51987654321\n/);
  assert.match(denunciados, /titulares de las cuentas 191-12345678-0-12\n/);
  assert.doesNotMatch(denunciados, /955444333|19400011122233|912000111|TR7N/);
  const verificar = text.split('\n').find((l) => l.includes('Se verifique a quién pertenecen'));
  assert.ok(verificar, text);
  for (const x of ['+51955444333', '19400011122233 (posible cuenta bancaria)', '+51912000111', 'TRON (USDT TRC-20) TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']) {
    assert.ok(verificar.includes(x), `${x} en: ${verificar}`);
  }
  assert.doesNotMatch(verificar, /bloqueo|inmoviliza|titulares/);
  assert.match(text, /Se identifique a los titulares de las cuentas indicadas para el pago Cuenta 191-12345678-0-12, se solicite el levantamiento/);
  assert.match(text, /bloqueo de las líneas/);
  // La cuenta del campo no se repite en la lista de verificación aunque también esté en el texto.
  const log2 = await plainLog([{ ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'whatsapp', contacto: '987654321', medioPago: 'yape', cuentaPago: '912345678', mensaje: 'Yapea al 912 345 678' }]);
  assert.doesNotMatch(buildComplaintText(log2, {}, NOW), /Se verifique a quién pertenecen/);
});

test('el propio celular de la víctima nunca se denuncia ni se verifica', async () => {
  const log = await plainLog([{
    ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'whatsapp', contacto: '999 888 777', medioPago: 'yape', cuentaPago: '999888777',
    mensaje: 'Sabemos que tu número es 999888777. Paga al +51 912 000 111',
  }]);
  const datos = { celular: '+51 999 888 777' };
  const text = buildComplaintText(log, datos, NOW);
  // Los hechos citan el registro tal cual; el petitorio y las diligencias no lo usan.
  const pedidos = text.slice(text.indexOf('I. PETITORIO'), text.indexOf('II. HECHOS')) + text.slice(text.indexOf('III. DILIGENCIAS'));
  assert.doesNotMatch(pedidos, /999 ?888 ?777/);
  assert.match(text, /mencionados en los mensajes: \+51912000111\./);
  assert.doesNotMatch(text, /usuarios de las líneas|WhatsApp \(Meta/);
  assert.deepEqual(extortionAccounts(log, datos), []);
  assert.equal(extortionAccounts(log).length, 1);
  assert.doesNotMatch(buildBankReportText(log, datos, NOW), /999888777/);
});

test('el reporte al banco usa solo la cuenta de pago y nunca dice "No indicaron"', async () => {
  const log = await plainLog(
    [{ ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'whatsapp', contacto: '987654321', cuentaPago: '191-12345678-0-12', mensaje: 'Deposita en 19112345678012 o a mi otra cuenta 19400011122233' }],
    [{ ocurridoEn: '2026-10-12T19:42:00-05:00', canal: 'whatsapp', contacto: '987654321', mensaje: 'Yapea al 912000111' }],
  );
  const cuentas = extortionAccounts(log);
  assert.deepEqual(cuentas.map((c) => [c.medio, c.valor, c.veces]), [['Cuenta', '191-12345678-0-12', 1]]);
  const text = buildBankReportText(log, {}, NOW);
  assert.match(text, /1\. Cuenta: 191-12345678-0-12 — indicada 1 vez/);
  assert.doesNotMatch(text, /No indicaron|19400011122233|912000111/);
});

test('la denuncia usa los datos corregidos, lo dice y agrega las precisiones', async () => {
  const log = await plainLog(
    [{ ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'whatsapp', contacto: '987654321', montoExigido: '5000', medioPago: 'yape', cuentaPago: '912345678', mensaje: 'Paga o ya sabes' }],
    [{ tipo: 'nota', refiereA: 0, corrige: { montoExigido: '$ 800', cuentaPago: '912000111' } }, at('2026-10-12T15:00:00Z')],
    [{ tipo: 'nota', refiereA: 0, descripcion: 'El mensaje llegó dos veces.' }, at('2026-10-13T15:00:00Z')],
  );
  const text = buildComplaintText(log, {}, NOW);
  assert.match(text, /Me exigieron US\$ 800\.00 \(dato corregido el 12\/10\/2026\), a pagar por Yape 912000111 \(dato corregido el 12\/10\/2026\)/);
  assert.match(text, /Precisión posterior del 13\/10\/2026: El mensaje llegó dos veces\./);
  assert.match(text, /titulares de las cuentas 912000111/);
  assert.doesNotMatch(text, /912345678|5,000/);
  const bank = buildBankReportText(log, {}, NOW);
  assert.match(bank, /Yape: 912000111/);
  assert.doesNotMatch(bank, /912345678/);
  // Corregir el contacto cambia a quién se denuncia.
  const log2 = await plainLog(
    [{ ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'llamada', contacto: '987654321', descripcion: 'Llamaron' }],
    [{ tipo: 'nota', refiereA: 0, corrige: { contacto: '912000222' } }, at('2026-10-12T15:00:00Z')],
  );
  const text2 = buildComplaintText(log2, {}, NOW);
  assert.match(text2, /usuarios de las líneas \+51912000222\n/);
  assert.match(text2, /desde \+51 912 000 222 \(dato corregido el 12\/10\/2026\)/);
  assert.doesNotMatch(text2, /987/);
});

test('montos en dólares en la denuncia', async () => {
  const log = await plainLog([{ ocurridoEn: '2026-10-11T19:42:00-05:00', canal: 'whatsapp', contacto: '987654321', montoExigido: '1000 dólares', mensaje: 'Paga' }]);
  assert.match(buildComplaintText(log, {}, NOW), /Me exigieron US\$ 1,000\.00\./);
});
