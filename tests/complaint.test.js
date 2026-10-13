import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vault } from '../js/core/vault.js';
import { MemoryStorage } from '../js/core/storage.js';
import { buildComplaintText, buildComplaintBody, buildPoliceComplaintText } from '../js/core/complaint.js';

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
  assert.match(text, /bloqueo o la suspensión de las líneas/);
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
  assert.match(text, /usuarios de las líneas[^\n]*\+51912000111/);
  assert.doesNotMatch(text, /coordenadas GPS/);
  assert.match(text, /Una vez realizadas las diligencias de identificación/);
});
