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

Cómo comprobar que las pruebas no fueron modificadas:
- Linux / macOS:   sha256sum -c huellas.sha256   (o: shasum -a 256 -c huellas.sha256)
- Windows (PowerShell):   Get-FileHash pruebas\\ARCHIVO -Algorithm SHA256
Cada huella debe coincidir con la del informe.

Las huellas prueban que un archivo no cambió desde que se registró en Escudo.
No reemplazan el peritaje del dispositivo original.
`;

/** Reúne todo en un ZIP. readFile(id) devuelve los bytes de una prueba. */
export async function buildEvidencePackage(log, readFile, { verificacion, generadoEn = new Date(), creadoEn } = {}) {
  const files = [];
  const hashes = [];
  const problemas = [];
  const incidents = log.filter((e) => e.tipo === 'incidente')
    .sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn));

  incidents.forEach((e, i) => e.adjuntos.forEach((a, k) => {
    files.push({ path: `pruebas/${String(i + 1).padStart(3, '0')}-${k + 1}-${safeName(a.nombre)}`, adjunto: a });
  }));

  const out = [];
  for (const f of files) {
    const bytes = await readFile(f.adjunto.id);
    const actual = await sha256Hex(bytes);
    if (actual !== f.adjunto.sha256) problemas.push(f.path);
    hashes.push(`${f.adjunto.sha256}  ${f.path}`);
    out.push({ name: f.path, bytes });
  }

  const opts = { verificacion, generadoEn, creadoEn };
  return {
    zip: createZip([
      { name: 'LEEME.txt', bytes: README + `\nGenerado el ${formatDate(generadoEn.toISOString())} (hora de Lima).\n` },
      { name: 'informe.html', bytes: buildHtmlReport(log, opts) },
      { name: 'informe.txt', bytes: buildTextReport(log, opts) },
      { name: 'huellas.sha256', bytes: hashes.join('\n') + (hashes.length ? '\n' : '') },
      { name: 'bitacora.json', bytes: JSON.stringify(log, null, 2) },
      ...out,
    ], generadoEn),
    archivos: out.length,
    problemas,
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
