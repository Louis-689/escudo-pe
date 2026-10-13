// Importa el chat que la víctima exporta desde WhatsApp ("Exportar chat").
// Soporta los formatos de Android y iPhone, en español e inglés, con hora de
// 12 o 24 horas. Cada mensaje conserva su autor, fecha, hora y archivos.

const SPACE = /[   ]/g;
const INVISIBLE = /[‎‏‪-‮﻿]/g;

// Android: 13/10/26, 9:15 p. m. - Autor: texto
const ANDROID = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([ap]\.? ?m\.?)? - (.*)$/i;
// iPhone: [13/10/26, 21:15:03] Autor: texto
const IOS = /^\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([ap]\.? ?m\.?)?\] (.*)$/i;

const ATTACHED = [
  /^(.+?\.[A-Za-z0-9]{2,5}) \((?:archivo adjunto|file attached)\)\s*$/i,
  /^<(?:adjunto|attached): (.+?)>\s*$/i,
];
const OMITTED = /^<?(?:multimedia omitido|media omitted|imagen omitida|image omitted|audio omitido|audio omitted|video omitido|video omitted|sticker omitido|sticker omitted|documento omitido|document omitted|gif omitido|gif omitted)>?$/i;

function normalizeLine(line) {
  return line.replace(INVISIBLE, '').replace(SPACE, ' ').replace(/\r$/, '');
}

function matchHeader(line) {
  const m = ANDROID.exec(line) || IOS.exec(line);
  if (!m) return null;
  return { a: +m[1], b: +m[2], y: +m[3], h: +m[4], min: +m[5], s: +(m[6] || 0), ampm: m[7] || '', rest: m[8] };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toIso(h, dayFirst, offset) {
  const day = dayFirst ? h.a : h.b;
  const month = dayFirst ? h.b : h.a;
  const year = h.y < 100 ? 2000 + h.y : h.y;
  let hour = h.h;
  const pm = /^p/i.test(h.ampm);
  const am = /^a/i.test(h.ampm);
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(h.min)}:${pad(h.s)}${offset}`;
}

/**
 * Convierte el texto exportado en mensajes.
 * offset: zona horaria del teléfono que exportó (Perú: -05:00, sin horario de verano).
 */
export function parseWhatsAppChat(text, { offset = '-05:00' } = {}) {
  const lines = String(text ?? '').split('\n').map(normalizeLine);
  const headers = lines.map(matchHeader);

  // ¿Día/mes o mes/día? Si algún primer número pasa de 12, es día/mes.
  let dayFirst = true;
  if (!headers.some((h) => h && h.a > 12) && headers.some((h) => h && h.b > 12)) dayFirst = false;

  const mensajes = [];
  let current = null;
  lines.forEach((line, i) => {
    const h = headers[i];
    if (h) {
      const colon = h.rest.indexOf(': ');
      const autor = colon > 0 ? h.rest.slice(0, colon).trim() : null;
      current = { linea: i + 1, fecha: toIso(h, dayFirst, offset), autor, texto: colon > 0 ? h.rest.slice(colon + 2) : h.rest, adjuntos: [], omitidos: 0 };
      mensajes.push(current);
    } else if (current && line !== '') {
      current.texto += '\n' + line;
    }
  });

  for (const m of mensajes) {
    const keep = [];
    for (const part of m.texto.split('\n')) {
      const t = part.trim();
      const att = ATTACHED.map((re) => re.exec(t)).find(Boolean);
      if (att) m.adjuntos.push(att[1].trim());
      else if (OMITTED.test(t)) m.omitidos += 1;
      else keep.push(part);
    }
    m.texto = keep.join('\n').trim();
  }

  const counts = new Map();
  for (const m of mensajes) if (m.autor) counts.set(m.autor, (counts.get(m.autor) || 0) + 1);
  const participantes = [...counts.entries()].map(([autor, total]) => ({ autor, total })).sort((a, b) => b.total - a.total);
  return { mensajes, participantes, diaPrimero: dayFirst };
}

/**
 * Agrupa los mensajes de los autores elegidos en registros para la bitácora.
 * Mensajes seguidos del mismo autor con menos de `gapMinutes` entre sí forman
 * un solo registro, para no llenar la bitácora de líneas sueltas.
 */
export function chatToIncidents(parsed, autores, { archivo = 'chat de WhatsApp', gapMinutes = 10 } = {}) {
  const chosen = new Set(autores);
  const groups = [];
  let g = null;
  for (const m of parsed.mensajes) {
    if (!m.autor || !chosen.has(m.autor)) {
      g = null;
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
  return groups.map((grp) => {
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
    };
  });
}
