import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vault } from '../js/core/vault.js';
import { MemoryStorage } from '../js/core/storage.js';
import { sha256Hex } from '../js/core/crypto.js';

const FAST = { iterations: 1000 };
const NOW = new Date('2026-10-13T12:00:00Z');
const incident = { ocurridoEn: '2026-10-12T20:30:00-05:00', canal: 'whatsapp', mensaje: 'Paga o ya sabes', contacto: '987654321' };
const audio = { nombre: 'audio.ogg', tipo: 'audio/ogg', bytes: new Uint8Array([1, 2, 3, 4, 5]) };

test('crear, agregar y volver a abrir la bitácora', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  const entry = await v.add(incident, [audio], NOW);
  assert.equal(entry.adjuntos[0].sha256, await sha256Hex(audio.bytes));
  assert.equal(entry.adjuntos[0].bytes, undefined, 'los bytes no se guardan en la bitácora');

  const again = await Vault.open(storage, 'clave-segura');
  assert.equal(again.log.length, 1);
  assert.deepEqual(await again.readFile(entry.adjuntos[0].id), audio.bytes);
  assert.equal((await again.verify()).ok, true);
});

test('nada se guarda en texto plano', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  await v.add(incident, [], NOW);
  const dump = JSON.stringify([...storage.map.values()]);
  assert.ok(!dump.includes('Paga o ya sabes'));
  assert.ok(!dump.includes('987'));
});

test('una contraseña incorrecta no abre la bitácora', async () => {
  const storage = new MemoryStorage();
  await Vault.create(storage, 'clave-segura', FAST);
  await assert.rejects(Vault.open(storage, 'otra-clave'), /contraseña incorrecta/);
});

test('contraseñas demasiado cortas se rechazan', async () => {
  await assert.rejects(Vault.create(new MemoryStorage(), '123', FAST), /al menos 6/);
});

test('no se puede crear dos veces la bitácora', async () => {
  const storage = new MemoryStorage();
  await Vault.create(storage, 'clave-segura', FAST);
  await assert.rejects(Vault.create(storage, 'clave-segura', FAST), /Ya existe/);
});

test('verify detecta un archivo dañado', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  const entry = await v.add(incident, [audio], NOW);
  await storage.set('file:' + entry.adjuntos[0].id, { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' });
  const r = await v.verify();
  assert.equal(r.ok, false);
  assert.deepEqual(r.archivosAlterados, ['audio.ogg']);
});

test('copia de seguridad: exportar e importar en otro teléfono', async () => {
  const v = await Vault.create(new MemoryStorage(), 'clave-segura', FAST);
  const entry = await v.add(incident, [audio], NOW);
  const backup = await v.exportBackup();
  assert.ok(!backup.includes('Paga o ya sabes'));

  const other = new MemoryStorage();
  await assert.rejects(Vault.importBackup(other, backup, 'mala-clave'), /contraseña incorrecta/);
  assert.equal(await Vault.exists(other), false, 'no escribe nada si la clave es incorrecta');

  const restored = await Vault.importBackup(other, backup, 'clave-segura');
  assert.equal(restored.log[0].huella, entry.huella);
  assert.deepEqual(await restored.readFile(entry.adjuntos[0].id), audio.bytes);
  await assert.rejects(Vault.importBackup(other, '{"x":1}', 'clave-segura'), /no es una copia/);
});

test('cambiar la contraseña mantiene los datos', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  const entry = await v.add(incident, [audio], NOW);
  await v.changePassword('nueva-clave');
  await assert.rejects(Vault.open(storage, 'clave-segura'));
  const reopened = await Vault.open(storage, 'nueva-clave');
  assert.deepEqual(await reopened.readFile(entry.adjuntos[0].id), audio.bytes);
  assert.equal((await reopened.verify()).ok, true);
});

test('borrar todo deja el teléfono limpio', async () => {
  const storage = new MemoryStorage();
  await Vault.create(storage, 'clave-segura', FAST);
  await Vault.wipe(storage);
  assert.equal(await Vault.exists(storage), false);
});
