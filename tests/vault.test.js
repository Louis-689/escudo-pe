import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vault, checkPassword, parseBackupBlob } from '../js/core/vault.js';
import { MemoryStorage } from '../js/core/storage.js';
import { sha256Hex, KDF_ITERATIONS } from '../js/core/crypto.js';

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
  await assert.rejects(Vault.create(new MemoryStorage(), '123', FAST), /al menos 8/);
  await assert.rejects(Vault.create(new MemoryStorage(), '19051987', FAST), /solo de números/);
  await assert.rejects(Vault.create(new MemoryStorage(), 'aaaaaaaaaa', FAST), /repite/);
  await Vault.create(new MemoryStorage(), 'perro azul ventana', FAST);
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
  const backup = await (await v.exportBackup()).text();
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

class FailingStorage extends MemoryStorage {
  async setMany(...args) {
    if (this.failing) throw new Error('disco lleno');
    return super.setMany(...args);
  }
}

test('si falla la escritura, la contraseña anterior sigue funcionando', async () => {
  const storage = new FailingStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  storage.failing = true;
  await assert.rejects(v.changePassword('nueva-clave'), /disco lleno/);
  const reopened = await Vault.open(storage, 'clave-segura');
  assert.equal(reopened.log.length, 0);
});

test('si falla al guardar un registro, la bitácora no cambia', async () => {
  const storage = new FailingStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  storage.failing = true;
  await assert.rejects(v.add(incident, [audio], NOW), /disco lleno/);
  assert.equal(v.log.length, 0);
  assert.deepEqual((await storage.keys()).sort(), ['log', 'meta', 'sello']);
});

test('importar una copia ignora claves extrañas y rechaza parámetros peligrosos', async () => {
  const v = await Vault.create(new MemoryStorage(), 'clave-segura', FAST);
  const data = JSON.parse(await (await v.exportBackup()).text());
  data.items['__proto__x'] = 'basura';
  const other = new MemoryStorage();
  await Vault.importBackup(other, JSON.stringify(data), 'clave-segura');
  assert.deepEqual((await other.keys()).sort(), ['log', 'meta', 'sello']);
  data.meta.iterations = 1e12;
  await assert.rejects(Vault.importBackup(new MemoryStorage(), JSON.stringify(data), 'clave-segura'), /no son válidos/);
});

test('el borrador cifrado sobrevive al bloqueo automático y se recupera una sola vez', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave larga 123');
  await v.saveDraft({ campos: { contacto: '987654321', mensaje: 'te vamos a' }, archivos: [{ nombre: 'grabacion.webm', tipo: 'audio/webm', bytes: new Uint8Array([9, 8, 7]), recibida: false }] });
  const raw = JSON.stringify([...storage.map.entries()]);
  assert.doesNotMatch(raw, /te vamos a|987654321/);
  const again = await Vault.open(storage, 'clave larga 123');
  const d = await again.takeDraft();
  assert.equal(d.campos.mensaje, 'te vamos a');
  assert.deepEqual([...d.archivos[0].bytes], [9, 8, 7]);
  assert.equal(await again.takeDraft(), null);
  // El borrador no entra en la copia de seguridad.
  await v.saveDraft({ campos: { mensaje: 'x' } });
  assert.doesNotMatch(await (await v.exportBackup()).text(), /borrador/);
});

test('verify detecta registros quitados al final y pruebas sin registro', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  await v.add(incident, [audio], NOW);
  await v.add({ ...incident, mensaje: 'segunda' }, [], NOW);
  assert.equal((await v.verify()).ok, true);
  assert.equal((await v.verify()).sello, 'ok');
  // Quitar el último registro deja la cadena válida, pero el sello lo delata.
  v.log = v.log.slice(0, 1);
  await storage.set('log', (await storage.get('log')));
  const r = await v.verify();
  assert.equal(r.sello, 'distinto');
  assert.equal(r.ok, false);
  // Quitar el registro que tenía la prueba deja un archivo huérfano.
  v.log = [];
  const r2 = await v.verify();
  assert.equal(r2.archivosHuerfanos.length, 1);
  assert.equal(r2.ok, false);
});

test('las bóvedas antiguas sin sello siguen verificando', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  await v.add(incident, [], NOW);
  await storage.del('sello');
  const r = await (await Vault.open(storage, 'clave-segura')).verify();
  assert.equal(r.sello, 'ausente');
  assert.equal(r.ok, true);
});

test('cambiar la contraseña sube las iteraciones, conserva el borrador y no se frena por un archivo dañado', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', { iterations: 1000 });
  const e = await v.add(incident, [audio], NOW);
  const sano = (await v.add({ ...incident, mensaje: 'otra' }, [{ ...audio, nombre: 'b.ogg', bytes: new Uint8Array([7]) }], NOW)).adjuntos[0];
  await v.saveDraft({ campos: { mensaje: 'a medias' }, archivos: [{ nombre: 'g.webm', tipo: 'audio/webm', bytes: new Uint8Array([4, 2]) }] });
  await storage.set('file:' + e.adjuntos[0].id, { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' });
  const { danados } = await v.changePassword('perro azul ventana');
  assert.deepEqual(danados, [e.adjuntos[0].id]);
  assert.equal(v.meta.iterations, KDF_ITERATIONS);
  assert.equal(KDF_ITERATIONS, 600000);
  const again = await Vault.open(storage, 'perro azul ventana');
  assert.equal(again.log.length, 2);
  assert.deepEqual([...await again.readFile(sano.id)], [7]);
  const d = await again.takeDraft();
  assert.equal(d.campos.mensaje, 'a medias');
  assert.deepEqual([...d.archivos[0].bytes], [4, 2]);
  const r = await again.verify();
  assert.deepEqual(r.archivosAlterados, ['audio.ogg']);
  assert.equal(r.sello, 'ok');
});

test('un borrador ilegible al cambiar la contraseña se avisa como perdido', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  await storage.set('borrador', { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' });
  await v.changePassword('perro azul ventana');
  assert.deepEqual(await (await Vault.open(storage, 'perro azul ventana')).takeDraft(), { perdido: true });
  assert.ok(!(await storage.keys()).some((k) => k.startsWith('borrador')));
});

test('política de contraseñas: mensajes claros y una sugerencia', () => {
  for (const bad of ['corta', '12345678901', '19051987', 'aaaaaaaa', 'abababab', 'abcabcabc', '111111111111']) {
    assert.throws(() => checkPassword(bad), /perro azul ventana/, bad);
  }
  assert.throws(() => checkPassword('1234567'), /al menos 8 caracteres/);
  assert.throws(() => checkPassword(undefined), /al menos 8/);
  for (const ok of ['perro azul ventana', '987654321012', 'Lima2026!']) checkPassword(ok);
});

test('bóvedas nuevas usan 600 000 iteraciones; las antiguas abren con las suyas', async () => {
  const nueva = await Vault.create(new MemoryStorage(), 'perro azul ventana');
  assert.equal(nueva.meta.iterations, 600000);
  // Una bóveda de una versión anterior (210 000 iteraciones, sin sello).
  const storage = new MemoryStorage();
  const vieja = await Vault.create(storage, 'clave-segura', { iterations: 210000 });
  await vieja.add(incident, [], NOW);
  await storage.del('sello');
  const abierta = await Vault.open(storage, 'clave-segura');
  assert.equal(abierta.meta.iterations, 210000);
  assert.equal((await abierta.verify()).ok, true);
});

test('un borrador ilegible se borra y se avisa', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  await storage.set('borrador', { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' });
  await storage.set('borrador:0', { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' });
  assert.deepEqual(await v.takeDraft(), { perdido: true });
  assert.ok(!(await storage.keys()).some((k) => k.startsWith('borrador')));
});

test('la copia es un Blob y se importa desde Blob, File o texto (también copias antiguas)', async () => {
  const v = await Vault.create(new MemoryStorage(), 'clave-segura', FAST);
  const entry = await v.add(incident, [audio], NOW);
  await v.savePlan({ hechos: { a: true }, palabraClave: 'girasol', notas: 'línea "uno"\\dos' });
  const blob = await v.exportBackup();
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'application/json');
  const text = await blob.text();
  // Mismo formato JSON de siempre.
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, 'escudo-pe/boveda/copia');
  assert.deepEqual(Object.keys(parsed.items).sort(), ['file:' + entry.adjuntos[0].id, 'log', 'plan', 'sello']);

  for (const source of [blob, new File([blob], 'copia.escudo'), text, new TextEncoder().encode(text)]) {
    const restored = await Vault.importBackup(new MemoryStorage(), source, 'clave-segura');
    assert.equal(restored.log[0].huella, entry.huella);
    assert.deepEqual(await restored.readFile(entry.adjuntos[0].id), audio.bytes);
    assert.equal((await restored.getPlan()).palabraClave, 'girasol');
    assert.equal((await restored.verify()).sello, 'ok');
  }

  // Copia de una versión anterior: sin sello, armada con JSON.stringify.
  const { sello, ...sinSello } = parsed.items;
  const vieja = JSON.stringify({ ...parsed, items: sinSello });
  for (const source of [vieja, new Blob([vieja])]) {
    const restored = await Vault.importBackup(new MemoryStorage(), source, 'clave-segura');
    const r = await restored.verify();
    assert.equal(r.sello, 'ausente');
    assert.equal(r.ok, true);
  }
  await assert.rejects(Vault.importBackup(new MemoryStorage(), new Blob(['no soy json']), 'clave-segura'), /no es una copia/);
  await assert.rejects(Vault.importBackup(new MemoryStorage(), new Blob([text.slice(0, -5)]), 'clave-segura'), /no es una copia/);
});

test('el lector por partes da lo mismo que JSON.parse aunque corte en cualquier lugar', async () => {
  const obj = {
    format: 'x', version: 1, meta: { a: [1, 2.5, -3e2, true, false, null], 'ñ💀': 'comillas \\" y \\\\ barra' },
    items: { log: { iv: 'abc', ct: 'q'.repeat(300) }, 'file:0123456789abcdef': { iv: 'x\\"y', ct: '\\\\' }, raro: [[], {}, ''], n: 7 },
    fin: 'ü',
  };
  for (const text of [JSON.stringify(obj), JSON.stringify(obj, null, 2)]) {
    for (const size of [1, 2, 3, 7, 64, 4096]) {
      assert.deepEqual({ ...(await parseBackupBlob(new Blob([text]), size)), items: undefined }, { ...obj, items: undefined }, `trozo ${size}`);
      assert.deepEqual({ ...(await parseBackupBlob(new Blob([text]), size)).items }, obj.items, `trozo ${size}`);
    }
  }
  for (const bad of ['', '{', '{"a":1', '{"a":1}x', '{"a" 1}', '{"a":1,}', '[1]', '{"items":{"a":1 "b":2}}', '{"a":tru}']) {
    await assert.rejects(parseBackupBlob(new Blob([bad]), 2), Error, bad);
  }
  // Una clave "__proto__" no cambia el prototipo de nada.
  const p = await parseBackupBlob(new Blob(['{"items":{"__proto__":{"x":1}}}']));
  assert.equal(Object.getPrototypeOf(p.items), null);
  assert.deepEqual(p.items.__proto__, { x: 1 });
});

test('datos extra cifrados: caso y fichas sobreviven a la copia y al cambio de contraseña', async () => {
  const storage = new MemoryStorage();
  const v = await Vault.create(storage, 'clave-segura', FAST);
  await v.saveExtra('caso', { numero: '123-2026' });
  await v.saveExtra('fichas', [{ formato: 'escudo-ficha/1' }]);
  await assert.rejects(v.saveExtra('otra', 1), /desconocido/);
  assert.doesNotMatch(JSON.stringify(await storage.get('extra:caso')), /123-2026/);
  await v.changePassword('perro azul ventana');
  const other = new MemoryStorage();
  const blob = await v.exportBackup();
  const w = await Vault.importBackup(other, blob, 'perro azul ventana');
  assert.deepEqual(await w.getExtra('caso'), { numero: '123-2026' });
  assert.equal((await w.getExtra('fichas')).length, 1);
  await w.saveExtra('caso', null);
  assert.equal(await w.getExtra('caso', 'nada'), 'nada');
});
