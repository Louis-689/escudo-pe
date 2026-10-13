// Informe para la denuncia: un resumen cronológico de la bitácora que la
// víctima puede imprimir, guardar como PDF o mostrar en la comisaría.

import { CANALES, MEDIOS_PAGO, formatSoles, summarize } from './model.js';

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sortedIncidents(log) {
  return log.filter((e) => e.tipo === 'incidente')
    .sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn))
    .map((e, i) => ({ ...e, numero: i + 1 }));
}

function notesFor(log, id) {
  return log.filter((e) => e.tipo === 'nota' && e.refiereA === id);
}

const LEGAL = 'Hechos que podrían constituir delito de extorsión (artículo 200 del Código Penal peruano).';
const HASH_NOTE = 'Cada prueba lleva su huella SHA-256, calculada al momento de registrarla. '
  + 'Si el archivo original produce la misma huella, no fue modificado desde entonces. '
  + 'Los registros están encadenados: editar, borrar o reordenar uno rompe la cadena.';

/** Informe en texto plano (para copiar, enviar a un abogado o imprimir). */
export function buildTextReport(log, { verificacion, generadoEn = new Date() } = {}) {
  const s = summarize(log);
  const lines = [];
  lines.push('INFORME DE INCIDENTES DE EXTORSIÓN');
  lines.push(`Generado con Escudo el ${formatDate(generadoEn.toISOString())} (hora de Lima)`);
  lines.push(LEGAL);
  lines.push('');
  lines.push('Denunciante: ______________________   DNI: ____________   Celular: ____________');
  lines.push('');
  lines.push('RESUMEN');
  lines.push(`- Incidentes registrados: ${s.totalIncidentes}`);
  if (s.primerIncidente) lines.push(`- Del ${formatDate(s.primerIncidente)} al ${formatDate(s.ultimoIncidente)}`);
  if (s.montoMaximo !== null) lines.push(`- Monto más alto exigido: ${formatSoles(s.montoMaximo)}`);
  if (s.contactos.length) lines.push('- Números o cuentas que contactaron: ' + s.contactos.map((c) => `${c.valor} (${c.veces})`).join('; '));
  if (s.cuentas.length) lines.push('- Cuentas indicadas para pagar: ' + s.cuentas.map((c) => `${c.valor} (${c.veces})`).join('; '));
  lines.push(`- Pruebas adjuntas: ${s.totalAdjuntos}`);
  if (verificacion) {
    lines.push(verificacion.ok
      ? '- Verificación de integridad: CORRECTA'
      : '- Verificación de integridad: CON PROBLEMAS (ver detalle en la app)');
  }
  lines.push('');
  lines.push('DETALLE CRONOLÓGICO');
  for (const e of sortedIncidents(log)) {
    lines.push('');
    lines.push(`#${e.numero} — ${formatDate(e.ocurridoEn)} — ${CANALES[e.canal]}`);
    if (e.contacto) lines.push(`  Desde: ${e.contacto}`);
    if (e.montoExigido !== null) lines.push(`  Monto exigido: ${formatSoles(e.montoExigido)}`);
    if (e.medioPago || e.cuentaPago) lines.push(`  Pago indicado: ${MEDIOS_PAGO[e.medioPago] || ''} ${e.cuentaPago}`.trimEnd());
    if (e.mensaje) lines.push(`  Mensaje: "${e.mensaje}"`);
    if (e.descripcion) lines.push(`  Descripción: ${e.descripcion}`);
    for (const a of e.adjuntos) lines.push(`  Prueba: ${a.nombre} (${a.tamano} bytes) SHA-256 ${a.sha256}`);
    for (const n of notesFor(log, e.id)) lines.push(`  Nota del ${formatDate(n.registradoEn)}: ${n.descripcion}`);
    lines.push(`  Registrado: ${formatDate(e.registradoEn)} · Huella ${e.huella}`);
  }
  lines.push('');
  lines.push(HASH_NOTE);
  if (log.length) lines.push(`Huella final de la bitácora: ${log[log.length - 1].huella}`);
  return lines.join('\n');
}

/** Contenido del informe en HTML, sin estilos (la app lo muestra con su propio CSS). */
export function buildReportBody(log, { verificacion, generadoEn = new Date() } = {}) {
  const s = summarize(log);
  const rows = sortedIncidents(log).map((e) => `
    <section class="inc">
      <h3>#${e.numero} · ${escapeHtml(formatDate(e.ocurridoEn))} · ${escapeHtml(CANALES[e.canal])}</h3>
      <dl>
        ${e.contacto ? `<dt>Desde</dt><dd>${escapeHtml(e.contacto)}</dd>` : ''}
        ${e.montoExigido !== null ? `<dt>Monto exigido</dt><dd>${escapeHtml(formatSoles(e.montoExigido))}</dd>` : ''}
        ${e.medioPago || e.cuentaPago ? `<dt>Pago indicado</dt><dd>${escapeHtml(MEDIOS_PAGO[e.medioPago] || '')} ${escapeHtml(e.cuentaPago)}</dd>` : ''}
        ${e.mensaje ? `<dt>Mensaje</dt><dd><q>${escapeHtml(e.mensaje)}</q></dd>` : ''}
        ${e.descripcion ? `<dt>Descripción</dt><dd>${escapeHtml(e.descripcion)}</dd>` : ''}
        ${e.adjuntos.map((a) => `<dt>Prueba</dt><dd>${escapeHtml(a.nombre)}<br><code>${a.sha256}</code></dd>`).join('')}
        ${notesFor(log, e.id).map((n) => `<dt>Nota (${escapeHtml(formatDate(n.registradoEn))})</dt><dd>${escapeHtml(n.descripcion)}</dd>`).join('')}
        <dt>Registrado</dt><dd>${escapeHtml(formatDate(e.registradoEn))}<br><code>${e.huella}</code></dd>
      </dl>
    </section>`).join('');

  const list = (items) => items.map((c) => `${escapeHtml(c.valor)} (${c.veces})`).join('; ');
  return `<h1>Informe de incidentes de extorsión</h1>
<p class="small">Generado con Escudo el ${escapeHtml(formatDate(generadoEn.toISOString()))} (hora de Lima). ${LEGAL}</p>
<p>Denunciante: <span class="blank"></span> DNI: <span class="blank"></span> Celular: <span class="blank"></span></p>
<h2>Resumen</h2>
<ul>
<li>Incidentes registrados: ${s.totalIncidentes}</li>
${s.primerIncidente ? `<li>Del ${escapeHtml(formatDate(s.primerIncidente))} al ${escapeHtml(formatDate(s.ultimoIncidente))}</li>` : ''}
${s.montoMaximo !== null ? `<li>Monto más alto exigido: ${escapeHtml(formatSoles(s.montoMaximo))}</li>` : ''}
${s.contactos.length ? `<li>Números o cuentas que contactaron: ${list(s.contactos)}</li>` : ''}
${s.cuentas.length ? `<li>Cuentas indicadas para pagar: ${list(s.cuentas)}</li>` : ''}
<li>Pruebas adjuntas: ${s.totalAdjuntos}</li>
${verificacion ? `<li>Verificación de integridad: <strong>${verificacion.ok ? 'CORRECTA' : 'CON PROBLEMAS'}</strong></li>` : ''}
</ul>
<h2>Detalle cronológico</h2>
${rows || '<p>No hay incidentes registrados.</p>'}
<h2>Sobre las huellas</h2>
<p class="small">${HASH_NOTE}</p>
${log.length ? `<p class="small">Huella final de la bitácora: <code>${log[log.length - 1].huella}</code></p>` : ''}`;
}

/** Informe como archivo HTML independiente, listo para imprimir o guardar como PDF. */
export function buildHtmlReport(log, options = {}) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe de incidentes</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;color:#111;background:#fff;margin:0 auto;max-width:800px;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:20px 0 8px;border-bottom:1px solid #999}
h3{font-size:14px;margin:0 0 6px}.inc{border:1px solid #bbb;border-radius:6px;padding:10px;margin:10px 0;break-inside:avoid}
dl{display:grid;grid-template-columns:130px 1fr;gap:4px 10px;margin:0}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
code{font-size:11px;word-break:break-all}.blank{border-bottom:1px solid #111;display:inline-block;min-width:180px}
.small{font-size:12px;color:#444}@media print{button{display:none}}
</style></head><body>
<button onclick="window.print()">Imprimir o guardar como PDF</button>
${buildReportBody(log, options)}
</body></html>`;
}
