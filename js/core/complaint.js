// Denuncia directa ante la Fiscalía y queja si la Policía no actúa.
//
// Toda persona puede denunciar un delito de persecución pública directamente
// ante el Ministerio Público (art. 326 del Código Procesal Penal), sin pasar
// por la comisaría. Escudo arma el escrito con los hechos, los datos y las
// diligencias que la víctima pide, listo para firmar y presentar.
//
// Los datos de la persona (nombre, DNI, domicilio) solo se usan para armar el
// documento: no se guardan en ningún lado.

import { CANALES, MEDIOS_PAGO, formatSoles } from './model.js';
import { consolidate } from './indicators.js';
import { formatDate, escapeHtml } from './report.js';

export const CANALES_DENUNCIA = [
  {
    nombre: 'Denuncia en línea del Ministerio Público',
    url: 'https://portal.mpfn.gob.pe/denuncias-en-linea/',
    detalle: 'Necesitas DNI y correo. Adjunta este escrito y el paquete de pruebas.',
  },
  {
    nombre: 'Mesa de partes de la Fiscalía Provincial Penal de tu distrito',
    url: 'https://www.gob.pe/11324',
    detalle: 'Lleva el escrito impreso y firmado, con una copia para que te la sellen como cargo.',
  },
];

export const CANALES_QUEJA = [
  {
    nombre: 'Denuncias contra policías (Mininter / Inspectoría PNP)',
    url: 'https://denuncias.mininter.gob.pe/registro',
    detalle: 'Si en la comisaría no te recibieron la denuncia o no hicieron nada.',
  },
  {
    nombre: 'Defensoría del Pueblo',
    url: 'https://www.gob.pe/10179',
    detalle: 'Queja gratuita cuando una entidad del Estado no atiende tu caso.',
  },
];

const BLANK = '____________________';

const clean = (v, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function denunciante(d = {}) {
  return {
    nombre: clean(d.nombre) || BLANK,
    dni: clean(d.dni, 12) || '__________',
    domicilio: clean(d.domicilio, 200) || BLANK,
    celular: clean(d.celular, 20) || '__________',
    correo: clean(d.correo, 120) || BLANK,
    ciudad: clean(d.ciudad, 60) || '__________',
    reserva: Boolean(d.reserva),
  };
}

const FRASE_CANAL = {
  llamada: 'una llamada telefónica', whatsapp: 'mensajes por WhatsApp', sms: 'un SMS',
  redes: 'mensajes por redes sociales', presencial: 'una amenaza en persona', nota: 'una nota o carta', otro: 'una comunicación',
};

function hecho(e) {
  const hasMonto = e.montoExigido !== null && e.montoExigido !== undefined;
  let first = `El ${formatDate(e.ocurridoEn)} (hora de Lima) recibí ${FRASE_CANAL[e.canal] || 'una comunicación'}${e.contacto ? ` desde ${e.contacto}` : ''}`;
  first += e.mensaje ? `, con el siguiente texto: "${e.mensaje}"` : ' de contenido extorsivo';
  const sentences = [first];
  if (e.descripcion) sentences.push(e.descripcion);
  let pago = hasMonto ? `Me exigieron ${formatSoles(e.montoExigido)}` : '';
  if (e.cuentaPago) {
    pago += `${hasMonto ? ', a' : 'Me indicaron'} pagar por ${MEDIOS_PAGO[e.medioPago] || 'la cuenta'} ${e.cuentaPago}`;
    if (e.titularCuenta) pago += `, cuyo titular, según muestra la aplicación, es "${e.titularCuenta}"`;
  }
  if (pago) sentences.push(pago);
  if (e.adjuntos.length) sentences.push(`Adjunto como prueba: ${e.adjuntos.map((a) => `${a.nombre} (SHA-256 ${a.sha256})`).join('; ')}`);
  return sentences.map((x) => x.trim().replace(/[.\s]+$/, '')).join('. ') + '.';
}

function sections(log, datos, generadoEn) {
  const d = denunciante(datos);
  const f = consolidate(log);
  const incidents = log.filter((e) => e.tipo === 'incidente').sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn));
  const telefonos = f.telefonos.map((t) => `${t.valor} (${t.tipo}, ${t.pais}; ${t.veces} vez/veces)`);
  const cuentas = f.cuentas.map((c) => `${c.medio ? (MEDIOS_PAGO[c.medio] || c.medio) + ' ' : ''}${c.valor}${c.titular ? `, titular mostrado "${c.titular}"` : ''}`);
  const billeteras = f.billeteras.map((b) => `${b.red} ${b.valor}`);
  const fotosGps = f.fotos.filter((x) => x.gps);
  const otros = [...f.perfiles, ...f.correos, ...f.enlaces, ...f.placas].map((x) => x.valor);

  const denunciados = ['Los que resulten responsables'];
  if (telefonos.length) denunciados.push(`usuarios de las líneas ${f.telefonos.map((t) => t.valor).join(', ')}`);
  if (cuentas.length || billeteras.length) denunciados.push(`titulares de las cuentas ${[...f.cuentas.map((c) => c.valor), ...f.billeteras.map((b) => b.valor)].join(', ')}`);

  const diligencias = [];
  if (telefonos.length) {
    diligencias.push(`Se identifique a los titulares de las líneas ${f.telefonos.map((t) => t.valor).join(', ')} y se solicite a las empresas operadoras el registro de llamadas y mensajes y la geolocalización de los equipos (D. Leg. 1182; art. 230 del Código Procesal Penal; D. Leg. 1708, trámite en 24 horas en casos de extorsión).`);
    diligencias.push('Se oficie a la empresa operadora el bloqueo o la suspensión de las líneas usadas para amenazarme.');
  }
  if (cuentas.length || billeteras.length) {
    diligencias.push(`Se identifique a los titulares de las cuentas y billeteras ${[...cuentas, ...billeteras].join('; ')}, se solicite el levantamiento del secreto bancario (art. 235 del Código Procesal Penal) y la inmovilización de los fondos.`);
  }
  if (fotosGps.length) {
    diligencias.push(`Se analicen las coordenadas GPS contenidas en ${fotosGps.length === 1 ? 'la foto recibida' : `las ${fotosGps.length} fotos recibidas`} (${fotosGps.map((x) => `${x.nombre}: ${x.gps.lat}, ${x.gps.lon}`).join('; ')}), que podrían indicar desde dónde se tomaron.`);
  }
  if (otros.length) diligencias.push(`Se investiguen los perfiles, correos, enlaces o placas mencionados: ${otros.join(', ')}.`);
  diligencias.push('Se realice pericia informática sobre mi celular y los archivos adjuntos, cuyas huellas SHA-256 figuran en el informe.');
  diligencias.push(`Se dicten medidas de protección para mí y mi familia${d.reserva ? ', incluida la reserva de mi identidad,' : ''} y se me derive a la Unidad de Asistencia a Víctimas y Testigos.`);

  return {
    d,
    encabezado: `SEÑOR(A) FISCAL PROVINCIAL PENAL DE TURNO DE ${d.ciudad.toUpperCase()}`,
    sumilla: 'Denuncia penal por el delito de extorsión (art. 200 del Código Penal) y solicitud de diligencias urgentes.',
    presentacion: `${d.nombre}, identificado(a) con DNI ${d.dni}, con domicilio en ${d.domicilio}, celular ${d.celular} y correo ${d.correo}, ante usted me presento y digo:`,
    petitorio: 'Al amparo del art. 326 del Código Procesal Penal, interpongo DENUNCIA PENAL por el delito de EXTORSIÓN (art. 200 del Código Penal) contra:',
    denunciados,
    hechos: incidents.map(hecho),
    diligencias,
    pruebas: [
      'Informe de incidentes generado con Escudo, con la cadena de huellas SHA-256 de cada registro.',
      'Paquete de pruebas (archivos originales y lista de huellas huellas.sha256), que entrego en un medio digital.',
      'Mi celular, que pongo a disposición para la pericia. No he borrado los mensajes originales.',
    ],
    fecha: `${d.ciudad}, ${formatDate(generadoEn.toISOString()).split(',')[0]}`,
  };
}

/** Escrito de denuncia en texto plano. */
export function buildComplaintText(log, datos = {}, generadoEn = new Date()) {
  const s = sections(log, datos, generadoEn);
  const L = [];
  L.push(s.encabezado, '', `SUMILLA: ${s.sumilla}`, '', s.presentacion, '');
  L.push('I. PETITORIO', s.petitorio);
  s.denunciados.forEach((x) => L.push(`   - ${x}`));
  L.push('', 'II. HECHOS');
  if (!s.hechos.length) L.push('   (Describa aquí los hechos.)');
  s.hechos.forEach((h, i) => L.push(`${i + 1}. ${h}`));
  L.push('', 'III. DILIGENCIAS URGENTES QUE SOLICITO');
  s.diligencias.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  L.push('', 'IV. MEDIOS PROBATORIOS');
  s.pruebas.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  L.push('', 'POR LO EXPUESTO: Solicito a usted admitir la presente denuncia, abrir investigación y disponer con urgencia las diligencias solicitadas.', '');
  L.push(s.fecha, '', '', '______________________________', s.d.nombre, `DNI ${s.d.dni}`);
  return L.join('\n');
}

/** Escrito de denuncia en HTML (para ver, imprimir o guardar como PDF). */
export function buildComplaintBody(log, datos = {}, generadoEn = new Date()) {
  const s = sections(log, datos, generadoEn);
  const ol = (items) => `<ol>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`;
  return `<p><strong>${escapeHtml(s.encabezado)}</strong></p>
<p class="right"><strong>SUMILLA:</strong> ${escapeHtml(s.sumilla)}</p>
<p>${escapeHtml(s.presentacion)}</p>
<h2>I. Petitorio</h2>
<p>${escapeHtml(s.petitorio)}</p>
<ul>${s.denunciados.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
<h2>II. Hechos</h2>
${s.hechos.length ? ol(s.hechos) : '<p>(Describa aquí los hechos.)</p>'}
<h2>III. Diligencias urgentes que solicito</h2>
${ol(s.diligencias)}
<h2>IV. Medios probatorios</h2>
${ol(s.pruebas)}
<p><strong>POR LO EXPUESTO:</strong> Solicito a usted admitir la presente denuncia, abrir investigación y disponer con urgencia las diligencias solicitadas.</p>
<p>${escapeHtml(s.fecha)}</p>
<p class="firma">______________________________<br>${escapeHtml(s.d.nombre)}<br>DNI ${escapeHtml(s.d.dni)}</p>`;
}

/**
 * Queja cuando la Policía no recibe la denuncia o no actúa. El rehusamiento o
 * la demora ilegal de un acto funcional es delito (art. 377 del Código Penal).
 */
export function buildPoliceComplaintText(datos = {}, generadoEn = new Date()) {
  const d = denunciante(datos);
  const lugar = clean(datos.comisaria, 120) || '____________________';
  const fechaIntento = clean(datos.fechaIntento, 40) || '__________';
  const quePaso = clean(datos.quePaso, 600) || 'no recibieron mi denuncia / no realizaron ninguna diligencia (marque lo que corresponda)';
  return [
    'QUEJA POR NO RECIBIR O NO TRAMITAR UNA DENUNCIA DE EXTORSIÓN',
    '',
    `Yo, ${d.nombre}, con DNI ${d.dni}, celular ${d.celular}, víctima de extorsión (art. 200 del Código Penal), presento queja por lo siguiente:`,
    '',
    `1. El ${fechaIntento} acudí a ${lugar} para denunciar la extorsión que sufro, con pruebas ordenadas (informe con huellas SHA-256 y paquete de pruebas).`,
    `2. El personal policial ${quePaso}.`,
    '3. Toda persona tiene derecho a denunciar (art. 326 del Código Procesal Penal). Omitir, rehusar o retardar ilegalmente un acto del cargo está penado (art. 377 del Código Penal).',
    '4. Mi vida y la de mi familia están en riesgo. Solicito que se investigue esta conducta, que se reciba mi denuncia de inmediato y que se adopten medidas de protección.',
    '',
    'Adjunto: copia de mi informe de incidentes y, de ser posible, nombre o grado del efectivo que me atendió.',
    '',
    `${d.ciudad}, ${formatDate(generadoEn.toISOString()).split(',')[0]}`,
    '',
    '______________________________',
    d.nombre,
    `DNI ${d.dni}`,
  ].join('\n');
}
