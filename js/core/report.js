// Informe para la denuncia: un resumen cronológico de la bitácora que la
// víctima puede imprimir, guardar como PDF o mostrar en la comisaría.

import {
  CANALES, MEDIOS_PAGO, MONEDAS, EVENTOS_CUSTODIA, CAMPOS_CORREGIBLES, formatMoney, summarize, applyCorrections,
  describeCorrection, etiquetaMedio,
} from './model.js';
import { consolidate, classifyPhone } from './indicators.js';

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

/** "1 vez" o "3 veces". */
export function veces(n) {
  return n === 1 ? '1 vez' : `${n} veces`;
}

/**
 * Un teléfono siempre con el mismo formato en los informes y escritos: los
 * celulares peruanos como "+51 987 654 321" y los demás en formato
 * internacional ("+573001234567"). Lo que no es un teléfono (un perfil, un
 * correo) se devuelve tal cual.
 */
export function formatoTelefono(valor) {
  const text = String(valor ?? '').trim();
  if (!text || /[a-z@]/i.test(text)) return text;
  const p = classifyPhone(text);
  if (!p) return text;
  const d = p.e164.slice(1);
  return /^519\d{8}$/.test(d) ? `+51 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : p.e164;
}

/** "el 11/10/2026, 07:42 p. m." o "entre el … y el …" (una sola fecha si las dos coinciden). */
export function rangoFechas(primera, ultima, formato = formatDate) {
  const a = formato(primera);
  const b = formato(ultima || primera);
  return a === b ? `el ${a}` : `entre el ${a} y el ${b}`;
}

/** true si el incidente trae un pago ya hecho con la forma esperada (campo opcional "pago"). */
export function tienePago(e) {
  const p = e && e.pago;
  return Boolean(p) && typeof p === 'object' && typeof p.monto === 'number' && Number.isFinite(p.monto) && p.monto > 0;
}

/** "por Yape", "en efectivo", "por depósito o transferencia bancaria"; nada si no se sabe. */
export function medioPagoFrase(medio) {
  if (!medio || medio === 'otro') return '';
  if (medio === 'efectivo') return 'en efectivo';
  if (medio === 'cuenta_bancaria') return 'por depósito o transferencia bancaria';
  return MEDIOS_PAGO[medio] ? `por ${MEDIOS_PAGO[medio]}` : '';
}

/** Pago hecho: "S/ 500.00 el 02/10/2026, 03:15 p. m. por Yape a 912345678, operación N.° 123". */
export function pagoHechoTexto(p) {
  const fecha = p.fecha && !Number.isNaN(new Date(p.fecha).getTime()) ? ` el ${formatDate(p.fecha)}` : '';
  const medio = medioPagoFrase(p.medio);
  const cuenta = String(p.cuenta ?? '').trim();
  const operacion = String(p.operacion ?? '').trim();
  return `${formatMoney(p.monto, p.moneda)}${fecha}${medio ? ` ${medio}` : ''}${cuenta ? ` a ${cuenta}` : ''}${operacion ? `, operación N.° ${operacion}` : ''}`;
}

/** Agrega el punto final sin duplicarlo ("p. m." ya lo trae). */
export function conPunto(text) {
  const t = String(text ?? '').trimEnd();
  return t.endsWith('.') ? t : t + '.';
}

// Los incidentes se muestran con los datos corregidos por las notas; la huella
// sigue siendo la del registro original, por eso se indica qué decía antes.
function sortedIncidents(log) {
  return applyCorrections(log).filter((e) => e.tipo === 'incidente')
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
const LEGAL_FOTO = 'Metadatos EXIF leídos de los archivos recibidos, tal como llegaron (no se modificaron). '
  + 'Si una foto conserva GPS, indica desde dónde se tomó; la marca, el modelo y el número de serie ayudan a vincular un equipo incautado. '
  + 'Se sugiere pericia informática sobre el archivo original.';

function fotoLine(x) {
  const parts = [];
  if (x.gps) parts.push(`GPS ${x.gps.lat}, ${x.gps.lon}${x.gps.altitud !== undefined ? ` (${x.gps.altitud} m)` : ''} https://maps.google.com/?q=${x.gps.lat},${x.gps.lon}`);
  const equipo = [x.marca, x.modelo].filter(Boolean).join(' ');
  if (equipo) parts.push(`equipo ${equipo}`);
  if (x.serieCamara) parts.push(`serie ${x.serieCamara}`);
  if (x.fechaOriginal) parts.push(`tomada ${x.fechaOriginal.replace('T', ' ')}`);
  if (x.software) parts.push(`software ${x.software}`);
  return parts.join(' · ');
}

const FOTO_PROPIA = 'Foto tomada por la víctima: ubicación omitida';

const ORIGEN = {
  contacto: 'quien contactó', 'cuenta de pago': 'cuenta indicada para pagar',
  mensaje: 'texto del mensaje', descripcion: 'descripción de la víctima',
};
const origenes = (x) => x.origenes.map((o) => ORIGEN[o] || o).join(', ');

/** Medio de la cuenta para mostrar ("Yape: "), o nada si no se sabe. */
function medioPrefix(medio) {
  return medio && medio !== 'otro' ? etiquetaMedio(medio) + ': ' : '';
}

/** Pago indicado en un incidente: "Yape 912345678" (nunca "No indicaron"). */
function pagoTexto(e) {
  return [e.medioPago ? MEDIOS_PAGO[e.medioPago] || '' : '', e.cuentaPago].filter(Boolean).join(' ') || '(sin dato)';
}

function valorOriginal(e, campo) {
  const v = e.corregido[campo].anterior;
  if (campo === 'montoExigido') {
    const moneda = e.corregido.moneda ? e.corregido.moneda.anterior : e.moneda;
    return typeof v === 'number' ? formatMoney(v, moneda) : 'sin monto';
  }
  if (campo === 'moneda') return MONEDAS[v] || MONEDAS.PEN;
  if (campo === 'medioPago') return v ? MEDIOS_PAGO[v] || v : 'sin indicar';
  return v || 'vacío';
}

/** " (dato corregido el ...; antes decía: ...)" para los datos de esos campos que se corrigieron. */
function corregidoTxt(e, ...campos) {
  const hechos = campos.filter((c) => e.corregido && e.corregido[c]);
  if (!hechos.length) return '';
  const fecha = hechos.map((c) => e.corregido[c].fecha).sort().pop();
  const antes = hechos.length === 1
    ? valorOriginal(e, hechos[0])
    : hechos.map((c) => `${CAMPOS_CORREGIBLES[c]}: ${valorOriginal(e, c)}`).join('; ');
  return ` (dato corregido el ${formatDate(fecha)}; antes decía: ${antes})`;
}

const corregido = (e, campo) => Boolean(e.corregido && e.corregido[campo]);

/** Filas [etiqueta, valor] de los datos de un incidente, con las correcciones indicadas. */
function datosIncidente(e) {
  const rows = [];
  if (e.contacto || corregido(e, 'contacto')) rows.push(['Desde', (formatoTelefono(e.contacto) || '(sin dato)') + corregidoTxt(e, 'contacto')]);
  if (typeof e.montoExigido === 'number' || corregido(e, 'montoExigido') || corregido(e, 'moneda')) {
    rows.push(['Monto exigido', (formatMoney(e.montoExigido, e.moneda) || '(sin monto)') + corregidoTxt(e, 'montoExigido', 'moneda')]);
  }
  if (e.medioPago || e.cuentaPago || corregido(e, 'medioPago') || corregido(e, 'cuentaPago')) {
    rows.push(['Pago indicado', pagoTexto(e) + corregidoTxt(e, 'medioPago', 'cuentaPago')]);
  }
  if (e.titularCuenta || corregido(e, 'titularCuenta')) rows.push(['Titular mostrado por la app', (e.titularCuenta || '(sin dato)') + corregidoTxt(e, 'titularCuenta')]);
  if (tienePago(e)) rows.push(['Pago hecho bajo amenaza', pagoHechoTexto(e.pago)]);
  return rows;
}

/** Línea de metadatos de un adjunto: solo de fotos recibidas; de las propias, nunca la ubicación. */
function adjuntoMeta(a) {
  if (!a.metadatos) return '';
  if (!a.recibida) return FOTO_PROPIA;
  const line = fotoLine(a.metadatos);
  return line ? `Metadatos: ${line}` : '';
}

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
  if (s.montoMaximo !== null) lines.push(`- Monto más alto exigido: ${formatMoney(s.montoMaximo)}`);
  if (s.montoMaximoUSD != null) lines.push(`- Monto más alto exigido en dólares: ${formatMoney(s.montoMaximoUSD, 'USD')}`);
  if (s.totalPagado != null) lines.push(`- Pagado bajo amenaza: ${formatMoney(s.totalPagado)}`);
  if (s.totalPagadoUSD != null) lines.push(`- Pagado bajo amenaza en dólares: ${formatMoney(s.totalPagadoUSD, 'USD')}`);
  if (s.contactos.length) lines.push('- Números o cuentas que contactaron: ' + s.contactos.map((c) => `${formatoTelefono(c.valor)} (${c.veces})`).join('; '));
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
  for (const t of f.telefonos) lines.push(`  - ${formatoTelefono(t.valor)} · ${t.tipo}, ${t.pais} · ${veces(t.veces)} · ${range(t)} · ${canales(t)} · origen: ${origenes(t)}`);
  lines.push('Cuentas y billeteras para pagos. ' + LEGAL_CTA);
  if (!f.cuentas.length && !f.billeteras.length) lines.push('  (ninguna registrada)');
  for (const c of f.cuentas) lines.push(`  - ${medioPrefix(c.medio)}${c.valor}${c.titular ? ` · titular mostrado: ${c.titular}` : ''} · ${c.tipo} · ${veces(c.veces)} · ${range(c)} · origen: ${origenes(c)}`);
  for (const b of f.billeteras) lines.push(`  - ${b.red}: ${b.valor} · ${range(b)}`);
  if (f.fotos.length) {
    lines.push('Metadatos de fotos recibidas. ' + LEGAL_FOTO);
    for (const x of f.fotos) lines.push(`  - ${x.nombre} (${formatDate(x.ocurridoEn)}${x.contacto ? `, de ${formatoTelefono(x.contacto)}` : ''}): ${fotoLine(x)}`);
  }
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
    for (const [k, v] of datosIncidente(e)) lines.push(`  ${k}: ${v}`);
    if (e.mensaje) lines.push(`  Mensaje: "${e.mensaje}"`);
    if (e.descripcion) lines.push(`  Descripción: ${e.descripcion}`);
    for (const a of e.adjuntos) {
      lines.push(`  Prueba: ${a.nombre} (${a.tamano} bytes) SHA-256 ${a.sha256}`);
      const meta = adjuntoMeta(a);
      if (meta) lines.push(`    ${meta}`);
    }
    for (const n of notesFor(log, e.id)) {
      if (n.corrige) lines.push(`  Corrección del ${formatDate(n.registradoEn)}: ${describeCorrection(n.corrige, e.moneda)}`);
      if (n.descripcion) lines.push(`  Nota del ${formatDate(n.registradoEn)}: ${n.descripcion}`);
    }
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
        ${datosIncidente(e).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}
        ${e.mensaje ? `<dt>Mensaje</dt><dd><q>${escapeHtml(e.mensaje)}</q></dd>` : ''}
        ${e.descripcion ? `<dt>Descripción</dt><dd>${escapeHtml(e.descripcion)}</dd>` : ''}
        ${e.adjuntos.map((a) => `<dt>Prueba</dt><dd>${escapeHtml(a.nombre)}<br><code>${escapeHtml(a.sha256)}</code>${adjuntoMeta(a) ? `<br>${escapeHtml(adjuntoMeta(a))}` : ''}</dd>`).join('')}
        ${notesFor(log, e.id).map((n) => [
    n.corrige ? `<dt>Corrección (${escapeHtml(formatDate(n.registradoEn))})</dt><dd>${escapeHtml(describeCorrection(n.corrige, e.moneda))}</dd>` : '',
    n.descripcion ? `<dt>Nota (${escapeHtml(formatDate(n.registradoEn))})</dt><dd>${escapeHtml(n.descripcion)}</dd>` : '',
  ].join('')).join('')}
        <dt>Registrado</dt><dd>${escapeHtml(formatDate(e.registradoEn))}<br><code>${escapeHtml(e.huella)}</code></dd>
      </dl>
    </section>`).join('');

  const list = (items) => items.map((c) => `${escapeHtml(formatoTelefono(c.valor))} (${c.veces})`).join('; ');
  return `<h1>Informe de incidentes de extorsión</h1>
<p class="small">Generado con Escudo el ${escapeHtml(formatDate(generadoEn.toISOString()))} (hora de Lima). ${LEGAL}</p>
<p>Denunciante: <span class="blank"></span> DNI: <span class="blank"></span> Celular: <span class="blank"></span></p>
<h2>Resumen</h2>
<ul>
<li>Incidentes registrados: ${s.totalIncidentes}</li>
${s.primerIncidente ? `<li>Del ${escapeHtml(formatDate(s.primerIncidente))} al ${escapeHtml(formatDate(s.ultimoIncidente))}</li>` : ''}
${s.montoMaximo !== null ? `<li>Monto más alto exigido: ${escapeHtml(formatMoney(s.montoMaximo))}</li>` : ''}
${s.montoMaximoUSD != null ? `<li>Monto más alto exigido en dólares: ${escapeHtml(formatMoney(s.montoMaximoUSD, 'USD'))}</li>` : ''}
${s.totalPagado != null ? `<li>Pagado bajo amenaza: ${escapeHtml(formatMoney(s.totalPagado))}</li>` : ''}
${s.totalPagadoUSD != null ? `<li>Pagado bajo amenaza en dólares: ${escapeHtml(formatMoney(s.totalPagadoUSD, 'USD'))}</li>` : ''}
${s.contactos.length ? `<li>Números o cuentas que contactaron: ${list(s.contactos)}</li>` : ''}
${s.cuentas.length ? `<li>Cuentas indicadas para pagar: ${list(s.cuentas)}</li>` : ''}
<li>Pruebas adjuntas: ${s.totalAdjuntos}</li>
${verificacion ? `<li>Verificación de integridad: <strong>${verificacion.ok ? 'CORRECTA' : 'CON PROBLEMAS'}</strong></li>` : ''}
</ul>
${f.riesgos.length ? `<p class="risk"><strong>Señales de riesgo:</strong> ${f.riesgos.map((r) => escapeHtml(RIESGO_TXT[r.valor] || r.valor)).join('; ')}. Se sugiere evaluar medidas de protección.</p>` : ''}
<h2>Datos para la Fiscalía</h2>
<h3>Números telefónicos vinculados</h3>
<p class="small">${LEGAL_TEL}</p>
${f.telefonos.length ? `<table><thead><tr><th>Número</th><th>Tipo / país</th><th>Veces</th><th>Fechas</th><th>Canal</th><th>Origen</th></tr></thead><tbody>${f.telefonos.map((t) => `<tr><td>${escapeHtml(formatoTelefono(t.valor))}</td><td>${escapeHtml(t.tipo)}, ${escapeHtml(t.pais)}</td><td>${t.veces}</td><td>${escapeHtml(range(t))}</td><td>${escapeHtml(canales(t))}</td><td>${escapeHtml(origenes(t))}</td></tr>`).join('')}</tbody></table>` : '<p>Ninguno registrado.</p>'}
<h3>Cuentas y billeteras para pagos</h3>
<p class="small">${LEGAL_CTA}</p>
${f.cuentas.length || f.billeteras.length ? `<table><thead><tr><th>Cuenta</th><th>Tipo</th><th>Veces</th><th>Fechas</th><th>Origen</th></tr></thead><tbody>${f.cuentas.map((c) => `<tr><td>${escapeHtml(medioPrefix(c.medio))}${escapeHtml(c.valor)}${c.titular ? `<br>Titular mostrado: <strong>${escapeHtml(c.titular)}</strong>` : ''}</td><td>${escapeHtml(c.tipo)}</td><td>${c.veces}</td><td>${escapeHtml(range(c))}</td><td>${escapeHtml(origenes(c))}</td></tr>`).join('')}${f.billeteras.map((b) => `<tr><td><code>${escapeHtml(b.valor)}</code></td><td>${escapeHtml(b.red)}</td><td>${b.veces}</td><td>${escapeHtml(range(b))}</td><td>${escapeHtml(origenes(b))}</td></tr>`).join('')}</tbody></table>` : '<p>Ninguna registrada.</p>'}
${f.fotos.length ? `<h3>Metadatos de fotos recibidas</h3><p class="small">${LEGAL_FOTO}</p><ul>${f.fotos.map((x) => `<li>${x.gps ? '<strong>Con GPS.</strong> ' : ''}${escapeHtml(x.nombre)} (${escapeHtml(formatDate(x.ocurridoEn))}${x.contacto ? `, de ${escapeHtml(formatoTelefono(x.contacto))}` : ''}): ${escapeHtml(fotoLine(x))}</li>`).join('')}</ul>` : ''}
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
