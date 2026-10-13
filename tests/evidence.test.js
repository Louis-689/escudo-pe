import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePackage, findByHash } from '../js/core/evidence.js';
import { Vault } from '../js/core/vault.js';
import { MemoryStorage } from '../js/core/storage.js';
import { sha256Hex } from '../js/core/crypto.js';
import { readZip } from './zip.test.js';

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
    'pruebas/001-1-audio.ogg', 'pruebas/002-1-captura_.._.._evil.png',
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
