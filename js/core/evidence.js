// Paquete de pruebas para entregar a la Policía, la Fiscalía o un abogado:
// un ZIP con los archivos originales, el informe y la lista de huellas.
// OJO: el paquete NO está cifrado. La app lo advierte antes de descargarlo.

import { createZip } from './zip.js';
import { buildHtmlReport, buildTextReport, formatDate } from './report.js';
import { sha256Hex } from './crypto.js';

function safeName(name) {
  const clean = String(name || 'archivo')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80);
  return clean || 'archivo';
}

const README = `PAQUETE DE PRUEBAS GENERADO CON ESCUDO

Contenido:
- informe.html y informe.txt: resumen y detalle cronológico de los incidentes.
- pruebas/: los archivos originales tal como se registraron.
- huellas.sha256: la huella SHA-256 de cada prueba.
- bitacora.json: la bitácora completa con su cadena de huellas.
- verificar.js: programa para comprobarlo todo de una vez (necesita Node.js).

Cómo comprobar que las pruebas no fueron modificadas:
- Linux / macOS:   sha256sum -c huellas.sha256   (o: shasum -a 256 -c huellas.sha256)
- Windows (PowerShell):   Get-FileHash pruebas\\ARCHIVO -Algorithm SHA256
Cada huella debe coincidir con la del informe.

Cómo comprobar la cadena de la bitácora (bitacora.json):
Cada registro guarda "huellaPrevia" (la huella del registro anterior) y "huella":
    huella = SHA-256( huellaPrevia + JSON canónico del registro )
- JSON canónico: el registro SIN los campos "huella" ni "huellaPrevia", sin
  espacios, con las claves de todos los objetos (también los anidados) ordenadas
  por código de carácter (como sort() de JavaScript) y sin los valores
  indefinidos. Textos y números se escriben igual que JSON.stringify.
- Se concatena huellaPrevia (64 caracteres) con ese JSON, se codifica en UTF-8
  y se calcula SHA-256; el resultado va en hexadecimal y minúsculas.
- El primer registro usa como huellaPrevia 64 ceros (000...000).
Si alguien cambia, quita o reordena un registro, la cadena se rompe desde ahí.
Cada adjunto de la bitácora lleva su "sha256": es la huella del archivo en pruebas/.

Para comprobar la cadena y los archivos de una vez (Node.js 12 o superior):
    node verificar.js
Termina con "TODO CORRECTO" o con la lista de problemas encontrados.

Las huellas prueban que un archivo no cambió desde que se registró en Escudo.
No reemplazan el peritaje del dispositivo original.
`;

// Programa autónomo (Node.js, sin dependencias) que va dentro del ZIP. Repite
// la regla de la cadena de model.js; tests/evidence.test.js lo ejecuta sobre un
// paquete real para que ambos no se separen.
const VERIFY_SCRIPT = `#!/usr/bin/env node
// Comprueba un paquete de pruebas de Escudo: la cadena de huellas de
// bitacora.json y la huella SHA-256 de cada archivo listado en huellas.sha256.
// Uso: node verificar.js [carpeta del paquete]   (por defecto, la de este archivo)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.resolve(process.argv[2] || __dirname);
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// JSON con las claves ordenadas, sin espacios y sin valores indefinidos.
function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

const problemas = [];
let bitacora = [];
try {
  bitacora = JSON.parse(fs.readFileSync(path.join(dir, 'bitacora.json'), 'utf8'));
  if (!Array.isArray(bitacora)) throw new Error('no es una lista');
} catch (e) {
  problemas.push('No se pudo leer bitacora.json: ' + e.message);
  bitacora = [];
}

let previa = '0'.repeat(64);
bitacora.forEach((r, i) => {
  const resto = Object.assign({}, r);
  delete resto.huella;
  delete resto.huellaPrevia;
  const esperada = sha256(previa + canonico(resto));
  if (r.huellaPrevia !== previa || r.huella !== esperada) {
    problemas.push('Cadena rota en el registro ' + (i + 1) + ' de bitacora.json.');
  }
  previa = r.huella;
});
console.log('Bitácora: ' + bitacora.length + ' registro(s). Huella final: ' + (bitacora.length ? previa : '(vacía)'));

// Huella de cada prueba según la bitácora (solo los incidentes llevan pruebas).
const registradas = new Map();
for (const r of bitacora) {
  if (r.tipo !== 'incidente') continue;
  for (const a of r.adjuntos || []) registradas.set(String(a.sha256).toLowerCase(), a.nombre);
}
const listadas = new Set();

let lineas = [];
try {
  lineas = fs.readFileSync(path.join(dir, 'huellas.sha256'), 'utf8').split(/\\r?\\n/);
} catch (e) {
  problemas.push('No se pudo leer huellas.sha256.');
}
let revisados = 0;
for (const linea of lineas) {
  const falta = /^#\\s*NO SE PUDO LEER[^:]*:\\s*([0-9a-f]{64})  (.+)$/i.exec(linea);
  if (falta) {
    listadas.add(falta[1].toLowerCase());
    problemas.push(falta[2] + ': falta en el paquete (no se pudo leer en el teléfono).');
    continue;
  }
  const m = /^([0-9a-f]{64}) [ *](.+)$/i.exec(linea);
  if (!m) continue;
  const huella = m[1].toLowerCase();
  const archivo = m[2];
  listadas.add(huella);
  if (!registradas.has(huella)) problemas.push(archivo + ': su huella no figura en bitacora.json.');
  let real;
  try {
    real = sha256(fs.readFileSync(path.join(dir, archivo)));
  } catch (e) {
    problemas.push(archivo + ': no se encontró el archivo.');
    continue;
  }
  revisados++;
  if (real !== huella) problemas.push(archivo + ': la huella NO coincide (el archivo cambió).');
}
for (const [huella, nombre] of registradas) {
  if (!listadas.has(huella)) problemas.push('La prueba "' + nombre + '" de bitacora.json no está en huellas.sha256.');
}
console.log('Archivos revisados: ' + revisados + '.');

if (problemas.length) {
  console.log('\\nSE ENCONTRARON PROBLEMAS:');
  for (const p of problemas) console.log('- ' + p);
  process.exitCode = 1;
} else {
  console.log('\\nTODO CORRECTO: la cadena está completa y cada archivo coincide con su huella.');
}
`;

/**
 * Reúne todo en un ZIP. readFile(id) devuelve los bytes de una prueba.
 * Si una prueba no se puede leer, el paquete se arma igual: queda anotada en
 * problemas, en ilegibles y como faltante en huellas.sha256 y LEEME.txt.
 */
export async function buildEvidencePackage(log, readFile, { verificacion, generadoEn = new Date(), creadoEn } = {}) {
  const files = [];
  const hashes = [];
  const problemas = [];
  const ilegibles = [];
  const incidents = log.filter((e) => e.tipo === 'incidente')
    .sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn));

  incidents.forEach((e, i) => (e.adjuntos || []).forEach((a, k) => {
    files.push({ path: `pruebas/${String(i + 1).padStart(3, '0')}-${k + 1}-${safeName(a.nombre)}`, adjunto: a });
  }));

  const out = [];
  for (const f of files) {
    let bytes;
    try {
      bytes = await readFile(f.adjunto.id);
    } catch {
      problemas.push(`${f.path} (no se pudo leer)`);
      ilegibles.push(f.path);
      // Comentario: sha256sum -c lo ignora y verificar.js lo informa como faltante.
      hashes.push(`# NO SE PUDO LEER (falta en el paquete): ${f.adjunto.sha256}  ${f.path}`);
      continue;
    }
    const actual = await sha256Hex(bytes);
    if (actual !== f.adjunto.sha256) problemas.push(f.path);
    hashes.push(`${f.adjunto.sha256}  ${f.path}`);
    out.push({ name: f.path, bytes });
  }

  const faltan = ilegibles.length
    ? `\nATENCIÓN: estas pruebas no se pudieron leer en el teléfono y NO están en el paquete\n(su huella registrada sigue en bitacora.json y en huellas.sha256):\n${ilegibles.map((p) => '- ' + p).join('\n')}\n`
    : '';
  const opts = { verificacion, generadoEn, creadoEn };
  return {
    zip: createZip([
      { name: 'LEEME.txt', bytes: README + faltan + `\nGenerado el ${formatDate(generadoEn.toISOString())} (hora de Lima).\n` },
      { name: 'informe.html', bytes: buildHtmlReport(log, opts) },
      { name: 'informe.txt', bytes: buildTextReport(log, opts) },
      { name: 'huellas.sha256', bytes: hashes.join('\n') + (hashes.length ? '\n' : '') },
      { name: 'bitacora.json', bytes: JSON.stringify(log, null, 2) },
      { name: 'verificar.js', bytes: VERIFY_SCRIPT },
      ...out,
    ], generadoEn),
    archivos: out.length,
    problemas,
    ilegibles,
  };
}

/** Busca en la bitácora una prueba con esa huella. */
export function findByHash(log, hash) {
  const h = String(hash).toLowerCase();
  const incidents = log.filter((e) => e.tipo === 'incidente')
    .sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn));
  for (let i = 0; i < incidents.length; i++) {
    const a = incidents[i].adjuntos.find((x) => x.sha256 === h);
    if (a) return { numero: i + 1, registro: incidents[i], adjunto: a };
  }
  return null;
}
