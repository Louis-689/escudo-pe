// Importa el chat que la víctima exporta desde WhatsApp ("Exportar chat").
// Soporta los formatos de Android y iPhone, en español e inglés, con hora de
// 12 o 24 horas y fechas día/mes o mes/día. Cada mensaje conserva su autor,
// fecha, hora y archivos, y una huella estable para no duplicarlo si el mismo
// chat se vuelve a importar más adelante.

const SPACE = /[\u00a0\u202f\u2007]/g;
const INVISIBLE = /[\u200e\u200f\u202a-\u202e\ufeff]/g;
const ODD_CHARS = /[\u00a0\u202f\u2007\u200e\u200f\u202a-\u202e\ufeff\r]/;
const MAYBE_HEADER = /^\[?\d/;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Android: 13/10/26, 9:15 p. m. - Autor: texto
const ANDROID = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([ap]\.? ?m\.?)? - (.*)$/i;
// iPhone: [13/10/26, 21:15:03] Autor: texto
const IOS = /^\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([ap]\.? ?m\.?)?\] (.*)$/i;
const DATE_TEXT = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/;

// Archivos adjuntos y multimedia omitida. El idioma de estas marcas sirve de
// pista para saber si la fecha viene como día/mes o mes/día.
const ATTACHED_ANDROID = /^(.+?\.[A-Za-z0-9]{2,5}) \((archivo adjunto|file attached)\)\s*$/i;
const ATTACHED_IOS = /^<(adjunto|attached): (.+?)>\s*$/i;
const OMITTED = /^<?(multimedia omitido|media omitted|imagen omitida|image omitted|audio omitido|audio omitted|video omitido|video omitted|sticker omitido|sticker omitted|documento omitido|document omitted|gif omitido|gif omitted)>?$/i;

// Mensajes que escribe WhatsApp (no las personas), en cada idioma.
const SYSTEM_EN = /end-to-end encrypted|created (?:this )?group|changed (?:the subject|this group|the group|their phone number)|\b(?:added|removed|left)\b|joined using|security code|disappearing messages|missed (?:voice|video) call|this message was deleted|you deleted this message/i;
const SYSTEM_ES = /cifrad[oa]s de extremo a extremo|creó (?:el |este )?grupo|añadió|eliminó a|salió|se unió|cambió|código de seguridad|mensajes temporales|llamada (?:de voz |de video |)perdida|se eliminó este mensaje|eliminaste este mensaje/i;
// En iPhone el aviso de cifrado sale a nombre del chat, como si fuera un mensaje.
const E2E_ES = /cifrad[oa]s de extremo a extremo/i;
const E2E_EN = /end-to-end encrypted/i;
const GENERATED_EN = /^(?:this message was deleted|you deleted this message|missed (?:voice|video) call)\.?$|<this message was edited>$/i;
const GENERATED_ES = /^(?:se eliminó este mensaje|eliminaste este mensaje|llamada (?:de voz |de video |)perdida)\.?$|<se editó este mensaje\.?>$/i;

// Un chat puede traer algún mensaje un poco fuera de orden (llegó tarde o
// el reloj del otro celular estaba adelantado); eso no cuenta como retroceso.
const BACKWARD_TOLERANCE_MS = 60 * 60000;
const FUTURE_TOLERANCE_MS = 10 * 60000;

function normalizeLine(line) {
  if (!ODD_CHARS.test(line)) return line;
  return line.replace(INVISIBLE, '').replace(SPACE, ' ').replace(/\r$/, '');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function daysInMonth(year, month) {
  if (month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) return 29;
  return DAYS[month - 1];
}

/** Fecha y hora de una cabecera según el orden elegido, o null si es imposible. */
function fields(h, dayFirst) {
  const day = dayFirst ? h.a : h.b;
  const month = dayFirst ? h.b : h.a;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(h.year, month)) return null;
  return { year: h.year, month, day };
}

function matchHeader(line) {
  if (!MAYBE_HEADER.test(line)) return null;
  const m = line[0] === '[' ? IOS.exec(line) : ANDROID.exec(line);
  if (!m) return null;
  const ampm = m[7] || '';
  let hour = +m[4];
  const min = +m[5];
  const s = +(m[6] || 0);
  if (ampm ? hour < 1 || hour > 12 : hour > 23) return null;
  if (min > 59 || s > 59) return null;
  if (/^p/i.test(ampm) && hour < 12) hour += 12;
  if (/^a/i.test(ampm) && hour === 12) hour = 0;
  const y = +m[3];
  const h = { a: +m[1], b: +m[2], year: y < 100 ? 2000 + y : y, hour, min, s, ampm, rest: m[8] };
  // Una fecha imposible en ambos órdenes (32/13/26) no es una cabecera: es texto.
  if (!fields(h, true) && !fields(h, false)) return null;
  return h;
}

function parseOffset(offset) {
  if (offset === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(offset));
  if (!m) throw new Error(`Zona horaria no válida: ${offset}`);
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
}

function toIso(h, f, offset) {
  return `${f.year}-${pad(f.month)}-${pad(f.day)}T${pad(h.hour)}:${pad(h.min)}:${pad(h.s)}${offset}`;
}

function toMs(h, f, offsetMin) {
  return Date.UTC(f.year, f.month - 1, f.day, h.hour, h.min, h.s) - offsetMin * 60000;
}

/** Cuenta, para una lectura, fechas imposibles, retrocesos y fechas futuras. */
function evaluateReading(heads, dayFirst, offsetMin, nowMs) {
  let imposibles = 0;
  let problemas = 0;
  let prev = -Infinity;
  for (const h of heads) {
    const f = fields(h, dayFirst);
    if (!f) {
      imposibles += 1;
      continue;
    }
    const t = toMs(h, f, offsetMin);
    if (t < prev - BACKWARD_TOLERANCE_MS) problemas += 1;
    if (t > nowMs + FUTURE_TOLERANCE_MS) problemas += 1;
    prev = t;
  }
  return { imposibles, problemas };
}

/**
 * ¿Día/mes o mes/día? Los mensajes van en orden cronológico y no pueden ser
 * del futuro: se elige la lectura con menos fechas imposibles, luego la que
 * no retrocede ni pasa de hoy, y si las dos son creíbles se usan pistas del
 * idioma. Si aun así no hay forma de saberlo, se queda día/mes y se avisa.
 */
function decideOrder(heads, { offsetMin, nowMs, forced, hints }) {
  if (!heads.some((h) => h.a !== h.b)) return { orden: 'dia', ambiguo: false };
  const dia = evaluateReading(heads, true, offsetMin, nowMs);
  const mes = evaluateReading(heads, false, offsetMin, nowMs);
  const forcedReading = forced === 'dia' ? dia : forced === 'mes' ? mes : null;
  if (forcedReading && forcedReading.imposibles === 0) return { orden: forced, ambiguo: false };
  if (dia.imposibles !== mes.imposibles) return { orden: dia.imposibles < mes.imposibles ? 'dia' : 'mes', ambiguo: false };
  if (dia.problemas !== mes.problemas) return { orden: dia.problemas < mes.problemas ? 'dia' : 'mes', ambiguo: false };
  // "PM" sin puntos es propio de celulares en inglés de EE. UU. (mes/día);
  // "p. m." o mensajes del sistema en español, de celulares en español (día/mes).
  if (hints.mesFuerte && !hints.dia) return { orden: 'mes', ambiguo: false };
  if (hints.dia && !hints.mesFuerte && !hints.mesDebil) return { orden: 'dia', ambiguo: false };
  // Inglés con hora de 24 horas: EE. UU. usa mes/día, pero otros países no.
  if (hints.mesDebil && !hints.dia) return { orden: 'mes', ambiguo: true };
  return { orden: 'dia', ambiguo: true };
}

/** Primera y última fecha de cada lectura, para que la persona elija. */
function samples(heads, lines, linesOf, offset) {
  if (!heads.every((h) => fields(h, true) && fields(h, false))) return null;
  const i = heads.findIndex((h) => h.a !== h.b);
  if (i < 0) return null;
  const read = (dayFirst) => ({
    ejemplo: toIso(heads[i], fields(heads[i], dayFirst), offset),
    desde: toIso(heads[0], fields(heads[0], dayFirst), offset),
    hasta: toIso(heads[heads.length - 1], fields(heads[heads.length - 1], dayFirst), offset),
  });
  const texto = (DATE_TEXT.exec(normalizeLine(lines[linesOf[i]])) || [''])[0];
  return { texto, dia: read(true), mes: read(false) };
}

const HEX = Array.from({ length: 256 }, (_, i) => (i + 0x100).toString(16).slice(1));

/**
 * FNV-1a de 64 bits (en hexadecimal) de varios textos seguidos, en UTF-8,
 * sin unirlos antes. El número va en cuatro trozos de 16 bits (de menor a mayor).
 */
function fnvParts(parts) {
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  let pending = 0;
  let extra = 0;
  for (let p = 0; p < parts.length; p++) {
    const str = parts[p];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c >= 0x80) {
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
          const d = str.charCodeAt(i + 1);
          if (d >= 0xdc00 && d < 0xe000) {
            c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
            i += 1;
          }
        }
        if (c >= 0xd800 && c < 0xe000) c = 0xfffd; // sustituto suelto, como TextEncoder
        // Bytes de continuación UTF-8 que faltan, guardados de 6 en 6 bits.
        if (c < 0x800) {
          extra = 1;
          pending = c & 0x3f;
          c = 0xc0 | (c >> 6);
        } else if (c < 0x10000) {
          extra = 2;
          pending = ((c >> 6) & 0x3f) | ((c & 0x3f) << 6);
          c = 0xe0 | (c >> 12);
        } else {
          extra = 3;
          pending = ((c >> 12) & 0x3f) | (((c >> 6) & 0x3f) << 6) | ((c & 0x3f) << 12);
          c = 0xf0 | (c >> 18);
        }
      }
      for (;;) {
        h0 ^= c;
        // Multiplica por el primo FNV 0x100000001b3 = 2^40 + 0x1b3.
        const t0 = h0 * 0x1b3;
        const t1 = h1 * 0x1b3 + (t0 >>> 16);
        const t2 = h2 * 0x1b3 + (h0 << 8) + (t1 >>> 16);
        h3 = (h3 * 0x1b3 + (h1 << 8) + (t2 >>> 16)) & 0xffff;
        h0 = t0 & 0xffff;
        h1 = t1 & 0xffff;
        h2 = t2 & 0xffff;
        if (!extra) break;
        extra -= 1;
        c = 0x80 | (pending & 0x3f);
        pending >>= 6;
      }
    }
  }
  return HEX[h3 >> 8] + HEX[h3 & 0xff] + HEX[h2 >> 8] + HEX[h2 & 0xff]
    + HEX[h1 >> 8] + HEX[h1 & 0xff] + HEX[h0 >> 8] + HEX[h0 & 0xff];
}

/**
 * FNV-1a de 64 bits (en hexadecimal) del texto en UTF-8. Es síncrona y rápida;
 * sirve para reconocer mensajes ya importados, no como prueba de integridad
 * (para eso está el SHA-256 de la bitácora).
 */
export function fnv1a64(text) {
  return fnvParts([String(text)]);
}

/**
 * Huella de un mensaje: FNV-1a de autor, fecha, texto y adjuntos separados por
 * caracteres de control que no aparecen en un chat (U+001F entre campos y
 * U+001E entre adjuntos). `copia` > 0 distingue mensajes idénticos repetidos.
 * Es lo mismo que fnv1a64 del texto unido, pero sin construirlo.
 */
function messageHash(m, copia) {
  const parts = [m.autor ?? '', '\u001f', m.fecha, '\u001f', m.texto, '\u001f'];
  m.adjuntos.forEach((a, k) => parts.push(...(k ? ['\u001e', a] : [a])));
  if (copia) parts.push('\u001f', String(copia));
  return fnvParts(parts);
}

/**
 * Convierte el texto exportado en mensajes.
 * offset: zona horaria del teléfono que exportó (Perú: -05:00, sin horario de verano).
 * now: fecha de referencia para descartar lecturas con fechas futuras.
 * orden: 'dia' o 'mes' para imponer el orden de la fecha (cuando la persona
 *   ya lo eligió); se ignora si con ese orden hay fechas imposibles.
 *
 * Devuelve { mensajes, participantes, orden, diaPrimero, ambiguo, muestras }.
 * Si ambiguo es true, las dos lecturas son creíbles: hay que preguntar con
 * muestras.texto, muestras.dia y muestras.mes, y volver a leer con { orden }.
 */
export function parseWhatsAppChat(text, { offset = '-05:00', now = Date.now(), orden } = {}) {
  const offsetMin = parseOffset(offset);
  const nowMs = now instanceof Date ? now.getTime() : Number.isFinite(+now) ? +now : Date.now();
  const lines = String(text ?? '').split('\n');
  const hints = { mesFuerte: false, mesDebil: false, dia: false };

  const mensajes = [];
  const heads = [];
  const linesOf = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeLine(lines[i]);
    const h = matchHeader(line);
    if (h) {
      if (/^[AP]M$/.test(h.ampm)) hints.mesFuerte = true;
      else if (h.ampm.includes('.')) hints.dia = true;
      const colon = h.rest.indexOf(': ');
      const autor = colon > 0 ? h.rest.slice(0, colon).trim() : null;
      current = { linea: i + 1, fecha: '', autor, texto: colon > 0 ? h.rest.slice(colon + 2) : h.rest, adjuntos: [], omitidos: 0 };
      mensajes.push(current);
      heads.push(h);
      linesOf.push(i);
    } else if (current && line !== '') {
      current.texto += '\n' + line;
    }
  }

  mensajes.forEach((m, idx) => {
    if (!m.autor) {
      if (SYSTEM_ES.test(m.texto)) hints.dia = true;
      else if (SYSTEM_EN.test(m.texto)) hints.mesDebil = true;
    } else if (idx < 3) {
      if (E2E_ES.test(m.texto)) hints.dia = true;
      else if (E2E_EN.test(m.texto)) hints.mesDebil = true;
    }
    const keep = [];
    for (const part of m.texto.split('\n')) {
      const t = part.trim();
      const end = t[t.length - 1];
      const android = end === ')' && ATTACHED_ANDROID.exec(t);
      const ios = !android && end === '>' && ATTACHED_IOS.exec(t);
      const omitted = !android && !ios && t.length <= 24 && OMITTED.exec(t);
      if (android || ios) {
        m.adjuntos.push((android ? android[1] : ios[2]).trim());
        if (/^(?:file attached|attached)$/i.test(android ? android[2] : ios[1])) hints.mesDebil = true;
        else hints.dia = true;
        continue;
      }
      if (omitted) {
        m.omitidos += 1;
        if (/omitted$/i.test(omitted[1])) hints.mesDebil = true;
        else hints.dia = true;
        continue;
      }
      if (m.autor && (t.length <= 32 || end === '>')) {
        if (GENERATED_ES.test(t)) hints.dia = true;
        else if (GENERATED_EN.test(t)) hints.mesDebil = true;
      }
      keep.push(part);
    }
    m.texto = keep.join('\n').trim();
  });

  const forced = orden === 'dia' || orden === 'mes' ? orden : undefined;
  const decision = decideOrder(heads, { offsetMin, nowMs, forced, hints });
  const dayFirst = decision.orden === 'dia';

  // Huella de cada mensaje. Si el mismo mensaje se repite idéntico en el
  // mismo minuto, cada copia lleva su número de aparición.
  const seen = new Map();
  mensajes.forEach((m, i) => {
    const h = heads[i];
    // Si la cabecera es imposible en el orden elegido (chat mezclado), se lee al revés.
    m.fecha = toIso(h, fields(h, dayFirst) || fields(h, !dayFirst), offset);
    const huella = messageHash(m, 0);
    const n = seen.get(huella) || 0;
    seen.set(huella, n + 1);
    m.huella = n ? messageHash(m, n) : huella;
  });

  const counts = new Map();
  for (const m of mensajes) if (m.autor) counts.set(m.autor, (counts.get(m.autor) || 0) + 1);
  const participantes = [...counts.entries()].map(([autor, total]) => ({ autor, total })).sort((a, b) => b.total - a.total);
  return {
    mensajes,
    participantes,
    orden: decision.orden,
    diaPrimero: dayFirst,
    ambiguo: decision.ambiguo,
    muestras: samples(heads, lines, linesOf, offset),
  };
}

/**
 * Agrupa los mensajes de los autores elegidos en registros para la bitácora.
 * Mensajes seguidos del mismo autor con menos de `gapMinutes` entre sí forman
 * un solo registro, para no llenar la bitácora de líneas sueltas.
 * existentes: huellas (Set o lista) de mensajes ya importados; se saltan.
 *
 * Devuelve la lista de registros; cada uno trae huellasChat con las huellas
 * de sus mensajes. La lista trae además `repetidos`: cuántos mensajes de esos
 * autores se saltaron por estar ya en la bitácora.
 */
export function chatToIncidents(parsed, autores, { archivo = 'chat de WhatsApp', gapMinutes = 10, existentes } = {}) {
  const chosen = new Set(autores);
  const known = existentes instanceof Set ? existentes : new Set(existentes || []);
  let repetidos = 0;
  const groups = [];
  let g = null;
  for (const m of parsed.mensajes) {
    if (!m.autor || !chosen.has(m.autor)) {
      g = null;
      continue;
    }
    if (known.has(m.huella)) {
      repetidos += 1;
      continue;
    }
    const t = Date.parse(m.fecha);
    if (g && g.autor === m.autor && t - g.last <= gapMinutes * 60000) {
      g.items.push(m);
      g.last = t;
    } else {
      g = { autor: m.autor, items: [m], last: t };
      groups.push(g);
    }
  }
  const incidents = groups.map((grp) => {
    const first = grp.items[0];
    const last = grp.items[grp.items.length - 1];
    const omitidos = grp.items.reduce((n, m) => n + m.omitidos, 0);
    const lineas = first.linea === last.linea ? `línea ${first.linea}` : `líneas ${first.linea}–${last.linea}`;
    return {
      ocurridoEn: first.fecha,
      canal: 'whatsapp',
      contacto: grp.autor,
      mensaje: grp.items.map((m) => (grp.items.length > 1 ? `[${m.fecha.slice(11, 16)}] ` : '') + (m.texto || '(archivo)')).join('\n'),
      descripcion: `Importado del ${archivo} (${lineas}).` + (omitidos ? ` ${omitidos} archivo(s) no se incluyeron en la exportación: vuelve a exportar el chat "con archivos".` : ''),
      adjuntoNombres: grp.items.flatMap((m) => m.adjuntos),
      huellasChat: grp.items.map((m) => m.huella),
    };
  });
  return Object.assign(incidents, { repetidos });
}
