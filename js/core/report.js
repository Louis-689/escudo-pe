// Informe para la denuncia: un resumen cronológico de la bitácora que la
// víctima puede imprimir, guardar como PDF o mostrar en la comisaría.

import { CANALES, MEDIOS_PAGO, EVENTOS_CUSTODIA, formatSoles, summarize } from './model.js';
import { consolidate } from './indicators.js';

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

const LEGAL_TEL = 'Para solicitar identificación del titular, registro de llamadas y mensajes y geolocalización '
  + '(D. Leg. 1182; Ley 27697 y art. 230 del Código Procesal Penal; D. Leg. 1708 de 2026, trámite en 24 horas en casos de extorsión).';
const LEGAL_CTA = 'Para solicitar a bancos y billeteras digitales la identidad de los titulares y el levantamiento del secreto bancario.';
const RIESGO_TXT = {
  muerte: 'amenaza de muerte o sicariato', explosivos: 'explosivos', familia: 'menciona a la familia o a los hijos',
  armas: 'armas', vigilancia: 'dicen vigilar a la víctima, su casa o negocio', plazo: 'fijan un plazo',
};
const DISPOSITIVO = 'Dispositivo de la víctima (para el acta): marca ____________ modelo ____________ IMEI ____________ línea ____________';

function range(x) {
  return x.primera === x.ultima ? formatDate(x.primera) : `${formatDate(x.primera)} – ${formatDate(x.ultima)}`;
}

function canales(x) {
  return x.canales.map((c) => CANALES[c] || c).join(', ');
}

function custodyEvents(log) {
  return log.filter((e) => e.tipo === 'custodia');
}

/** Informe en texto plano (para copiar, enviar a un abogado o imprimir). */
export function buildTextReport(log, { verificacion, generadoEn = new Date(), creadoEn } = {}) {
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
  const f = consolidate(log);
  if (f.riesgos.length) {
    lines.push('');
    lines.push('SEÑALES DE RIESGO: ' + f.riesgos.map((r) => RIESGO_TXT[r.valor] || r.valor).join('; ') + '. Se sugiere evaluar medidas de protección.');
  }
  lines.push('');
  lines.push('DATOS PARA LA FISCALÍA');
  lines.push('Números telefónicos vinculados. ' + LEGAL_TEL);
  if (!f.telefonos.length) lines.push('  (ninguno registrado)');
  for (const t of f.telefonos) lines.push(`  - ${t.valor} · ${t.tipo}, ${t.pais} · ${t.veces} vez/veces · ${range(t)} · ${canales(t)} · origen: ${t.origenes.join(', ')}`);
  lines.push('Cuentas y billeteras para pagos. ' + LEGAL_CTA);
  if (!f.cuentas.length && !f.billeteras.length) lines.push('  (ninguna registrada)');
  for (const c of f.cuentas) lines.push(`  - ${c.medio ? (MEDIOS_PAGO[c.medio] || c.medio) + ': ' : ''}${c.valor} · ${c.tipo} · ${c.veces} vez/veces · ${range(c)}`);
  for (const b of f.billeteras) lines.push(`  - ${b.red}: ${b.valor} · ${range(b)}`);
  const otros = [...f.perfiles.map((x) => ['Perfil', x]), ...f.enlaces.map((x) => ['Enlace', x]), ...f.correos.map((x) => ['Correo', x]), ...f.placas.map((x) => ['Placa', x])];
  if (otros.length) {
    lines.push('Otros indicios:');
    for (const [k, x] of otros) lines.push(`  - ${k}: ${x.valor} · ${range(x)}`);
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
  lines.push('CADENA DE CUSTODIA');
  if (creadoEn) lines.push(`- Bitácora creada el ${formatDate(creadoEn)}`);
  for (const c of custodyEvents(log)) lines.push(`- ${formatDate(c.registradoEn)}: ${EVENTOS_CUSTODIA[c.evento]}${c.descripcion ? ' — ' + c.descripcion : ''}`);
  lines.push(DISPOSITIVO);
  lines.push('');
  lines.push(HASH_NOTE);
  if (log.length) lines.push(`Huella final de la bitácora: ${log[log.length - 1].huella}`);
  return lines.join('\n');
}

/** Contenido del informe en HTML, sin estilos (la app lo muestra con su propio CSS). */
export function buildReportBody(log, { verificacion, generadoEn = new Date(), creadoEn } = {}) {
  const f = consolidate(log);
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
        ${e.adjuntos.map((a) => `<dt>Prueba</dt><dd>${escapeHtml(a.nombre)}<br><code>${escapeHtml(a.sha256)}</code></dd>`).join('')}
        ${notesFor(log, e.id).map((n) => `<dt>Nota (${escapeHtml(formatDate(n.registradoEn))})</dt><dd>${escapeHtml(n.descripcion)}</dd>`).join('')}
        <dt>Registrado</dt><dd>${escapeHtml(formatDate(e.registradoEn))}<br><code>${escapeHtml(e.huella)}</code></dd>
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
${f.riesgos.length ? `<p class="risk"><strong>Señales de riesgo:</strong> ${f.riesgos.map((r) => escapeHtml(RIESGO_TXT[r.valor] || r.valor)).join('; ')}. Se sugiere evaluar medidas de protección.</p>` : ''}
<h2>Datos para la Fiscalía</h2>
<h3>Números telefónicos vinculados</h3>
<p class="small">${LEGAL_TEL}</p>
${f.telefonos.length ? `<table><thead><tr><th>Número</th><th>Tipo / país</th><th>Veces</th><th>Fechas</th><th>Canal</th></tr></thead><tbody>${f.telefonos.map((t) => `<tr><td>${escapeHtml(t.valor)}</td><td>${escapeHtml(t.tipo)}, ${escapeHtml(t.pais)}</td><td>${t.veces}</td><td>${escapeHtml(range(t))}</td><td>${escapeHtml(canales(t))}</td></tr>`).join('')}</tbody></table>` : '<p>Ninguno registrado.</p>'}
<h3>Cuentas y billeteras para pagos</h3>
<p class="small">${LEGAL_CTA}</p>
${f.cuentas.length || f.billeteras.length ? `<table><thead><tr><th>Cuenta</th><th>Tipo</th><th>Veces</th><th>Fechas</th></tr></thead><tbody>${f.cuentas.map((c) => `<tr><td>${escapeHtml(c.medio ? (MEDIOS_PAGO[c.medio] || c.medio) + ': ' : '')}${escapeHtml(c.valor)}</td><td>${escapeHtml(c.tipo)}</td><td>${c.veces}</td><td>${escapeHtml(range(c))}</td></tr>`).join('')}${f.billeteras.map((b) => `<tr><td><code>${escapeHtml(b.valor)}</code></td><td>${escapeHtml(b.red)}</td><td>${b.veces}</td><td>${escapeHtml(range(b))}</td></tr>`).join('')}</tbody></table>` : '<p>Ninguna registrada.</p>'}
${f.perfiles.length || f.enlaces.length || f.correos.length || f.placas.length ? `<h3>Otros indicios</h3><ul>${[
    ...f.perfiles.map((x) => ['Perfil', x]), ...f.enlaces.map((x) => ['Enlace', x]),
    ...f.correos.map((x) => ['Correo', x]), ...f.placas.map((x) => ['Placa', x]),
  ].map(([k, x]) => `<li>${k}: ${escapeHtml(x.valor)} · ${escapeHtml(range(x))}</li>`).join('')}</ul>` : ''}
<h2>Detalle cronológico</h2>
${rows || '<p>No hay incidentes registrados.</p>'}
<h2>Cadena de custodia</h2>
<ul>
${creadoEn ? `<li>Bitácora creada el ${escapeHtml(formatDate(creadoEn))}</li>` : ''}
${custodyEvents(log).map((c) => `<li>${escapeHtml(formatDate(c.registradoEn))}: ${escapeHtml(EVENTOS_CUSTODIA[c.evento])}${c.descripcion ? ' — ' + escapeHtml(c.descripcion) : ''}</li>`).join('')}
</ul>
<p>${DISPOSITIVO.replace(/_+/g, '<span class="blank"></span>')}</p>
<h2>Sobre las huellas</h2>
<p class="small">${HASH_NOTE}</p>
${log.length ? `<p class="small">Huella final de la bitácora: <code>${escapeHtml(log[log.length - 1].huella)}</code></p>` : ''}`;
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
.small{font-size:12px;color:#444}table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}th,td{border:1px solid #bbb;padding:4px;text-align:left;vertical-align:top;overflow-wrap:anywhere}.risk{border:2px solid #b42318;padding:8px;border-radius:6px}@media print{button{display:none}}
</style></head><body>
<button onclick="window.print()">Imprimir o guardar como PDF</button>
${buildReportBody(log, options)}
</body></html>`;
}
