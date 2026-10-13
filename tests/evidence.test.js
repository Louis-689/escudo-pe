import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePackage, findByHash } from '../js/core/evidence.js';
import { Vault } from '../js/core/vault.js';
import { MemoryStorage } from '../js/core/storage.js';
import { sha256Hex } from '../js/core/crypto.js';
import { readZip } from './zip.test.js';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const NOW = new Date('2026-10-13T12:00:00Z');
const dec = new TextDecoder();

async function sampleVault() {
  const v = await Vault.create(new MemoryStorage(), 'clave-segura', { iterations: 1000 });
  await v.add({ ocurridoEn: '2026-10-12T20:00:00-05:00', canal: 'whatsapp', mensaje: 'paga' },
    [{ nombre: 'captura/../../evil.png', tipo: 'image/png', bytes: new Uint8Array([1, 2, 3]) }], NOW);
  await v.add({ ocurridoEn: '2026-10-10T08:00:00-05:00', canal: 'llamada', descripcion: 'primera' },
    [{ nombre: 'audio.ogg', tipo: 'audio/ogg', bytes: new Uint8Array([9, 9]) }], NOW);
  return v;
}

test('el paquete incluye pruebas, informe, huellas y bitácora', async () => {
  const v = await sampleVault();
  const pkg = await buildEvidencePackage(v.log, (id) => v.readFile(id), { verificacion: { ok: true }, generadoEn: NOW });
  assert.equal(pkg.archivos, 2);
  assert.deepEqual(pkg.problemas, []);
  const files = readZip(pkg.zip);
  assert.deepEqual(Object.keys(files).sort(), [
    'LEEME.txt', 'bitacora.json', 'huellas.sha256', 'informe.html', 'informe.txt',
    'pruebas/001-1-audio.ogg', 'pruebas/002-1-captura_.._.._evil.png', 'verificar.js',
  ]);
  const sums = dec.decode(files['huellas.sha256']).trim().split('\n');
  for (const line of sums) {
    const [hash, path] = line.split('  ');
    assert.equal(await sha256Hex(files[path]), hash, path);
  }
  assert.equal(JSON.parse(dec.decode(files['bitacora.json'])).length, 2);
  assert.match(dec.decode(files['informe.txt']), /INFORME DE INCIDENTES/);
});

test('findByHash encuentra la prueba y su número de incidente', async () => {
  const v = await sampleVault();
  const hit = findByHash(v.log, (await sha256Hex(new Uint8Array([9, 9]))).toUpperCase());
  assert.equal(hit.numero, 1);
  assert.equal(hit.adjunto.nombre, 'audio.ogg');
  assert.equal(findByHash(v.log, 'f'.repeat(64)), null);
});

/** Extrae el paquete en una carpeta temporal y ejecuta el verificar.js que trae. */
function extract(files) {
  const dir = mkdtempSync(join(tmpdir(), 'escudo-paquete-'));
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
  return dir;
}
const runVerifier = (dir) => spawnSync(process.execPath, [join(dir, 'verificar.js')], { encoding: 'utf8' });

test('LEEME explica la regla exacta de la cadena', async () => {
  const v = await sampleVault();
  const pkg = await buildEvidencePackage(v.log, (id) => v.readFile(id), { generadoEn: NOW });
  const leeme = dec.decode(readZip(pkg.zip)['LEEME.txt']);
  assert.match(leeme, /huella = SHA-256\( huellaPrevia \+ JSON canónico del registro \)/);
  assert.match(leeme, /SIN los campos "huella" ni "huellaPrevia"/);
  assert.match(leeme, /ordenadas/);
  assert.match(leeme, /indefinidos/);
  assert.match(leeme, /64 ceros/);
  assert.match(leeme, /node verificar\.js/);
});

test('el verificar.js del paquete comprueba la cadena y los archivos', async () => {
  const v = await sampleVault();
  // Foto con GPS (metadatos anidados), tildes, eñes y emojis: la regla canónica debe coincidir.
  const foto = new Uint8Array(readFileSync(new URL('./fixtures/foto-gps.jpg', import.meta.url)));
  await v.add({ ocurridoEn: '2026-10-11T09:15:00-05:00', canal: 'sms', mensaje: 'Señora, último aviso 💀 ¿pagará?' },
    [{ nombre: 'foto ñandú.jpg', tipo: 'image/jpeg', bytes: foto, recibida: true }], NOW);
  await v.add({ tipo: 'nota', refiereA: v.log[0].id, descripcion: 'Llamé a mi hermano' }, [], NOW);
  await v.logCustody('verificacion', 'Correcta', 'prueba');
  const pkg = await buildEvidencePackage(v.log, (id) => v.readFile(id), { generadoEn: NOW });
  const dir = extract(readZip(pkg.zip));
  try {
    let r = runVerifier(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /TODO CORRECTO/);
    assert.match(r.stdout, new RegExp(v.log[v.log.length - 1].huella));

    // Un archivo cambiado.
    const audio = join(dir, 'pruebas/001-1-audio.ogg');
    const original = readFileSync(audio);
    writeFileSync(audio, new Uint8Array([9, 9, 9]));
    r = runVerifier(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /001-1-audio\.ogg: la huella NO coincide/);
    writeFileSync(audio, original);

    // Un registro editado en bitacora.json.
    const bitacora = JSON.parse(readFileSync(join(dir, 'bitacora.json'), 'utf8'));
    bitacora[1].mensaje = 'otro texto';
    writeFileSync(join(dir, 'bitacora.json'), JSON.stringify(bitacora));
    r = runVerifier(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Cadena rota en el registro 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('una prueba ilegible no impide armar el paquete', async () => {
  const v = await sampleVault();
  const roto = v.log[0].adjuntos[0].id; // captura (incidente 2 por fecha)
  const pkg = await buildEvidencePackage(v.log, (id) => (id === roto ? Promise.reject(new Error('dañado')) : v.readFile(id)), { generadoEn: NOW });
  assert.equal(pkg.archivos, 1);
  assert.deepEqual(pkg.problemas, ['pruebas/002-1-captura_.._.._evil.png (no se pudo leer)']);
  assert.deepEqual(pkg.ilegibles, ['pruebas/002-1-captura_.._.._evil.png']);
  const files = readZip(pkg.zip);
  assert.equal(files['pruebas/002-1-captura_.._.._evil.png'], undefined);
  const sums = dec.decode(files['huellas.sha256']);
  assert.match(sums, /^# NO SE PUDO LEER \(falta en el paquete\): [0-9a-f]{64} {2}pruebas\/002-1-captura/m);
  assert.match(dec.decode(files['LEEME.txt']), /ATENCIÓN: estas pruebas no se pudieron leer[\s\S]*002-1-captura/);
  const dir = extract(files);
  try {
    const r = runVerifier(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /002-1-captura_\.\._\.\._evil\.png: falta en el paquete/);
    assert.doesNotMatch(r.stdout, /no está en huellas\.sha256/);
    // sha256sum -c ignora la línea comentada y comprueba el resto.
    const check = spawnSync('sha256sum', ['-c', 'huellas.sha256'], { cwd: dir, encoding: 'utf8' });
    if (!check.error) assert.equal(check.status, 0, check.stdout + check.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
