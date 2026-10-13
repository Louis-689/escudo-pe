// Metadatos EXIF de fotos JPEG: GPS, marca y modelo del celular y fecha de la toma.
//
// WhatsApp borra estos datos cuando una foto se envía como "foto", pero los
// conserva cuando se envía como "documento", y muchas fotos llegan por otras
// vías (correo, Telegram, USB) con todo intacto. Si el extorsionador manda una
// foto de tu casa o de tu negocio tomada con su celular, puede revelar desde
// dónde la tomó y con qué equipo. Escudo solo lee el archivo que ya tienes;
// no se conecta a nada.

const TAGS_IFD0 = { 0x010f: 'marca', 0x0110: 'modelo', 0x0131: 'software', 0x0132: 'fecha' };
const TAGS_EXIF = { 0x9003: 'fechaOriginal', 0x9011: 'zonaOriginal', 0xa431: 'serieCamara', 0xa434: 'lente' };
const EXIF_POINTER = 0x8769;
const GPS_POINTER = 0x8825;
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readTiff(view, start, length) {
  const end = start + length;
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  if (u16(start + 2) !== 42) return null;

  function ifd(offset) {
    const tags = new Map();
    const base = start + offset;
    if (offset < 8 || base + 2 > end) return tags;
    const n = u16(base);
    for (let i = 0; i < n && i < 512; i++) {
      const e = base + 2 + i * 12;
      if (e + 12 > end) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] || 0) * count;
      if (!size || size > 65536) continue;
      const at = size <= 4 ? e + 8 : start + u32(e + 8);
      if (at < start || at + size > end) continue;
      tags.set(tag, { type, count, at });
    }
    return tags;
  }

  function value(t) {
    if (!t) return undefined;
    if (t.type === 2) {
      let s = '';
      for (let i = 0; i < t.count; i++) {
        const c = view.getUint8(t.at + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s.trim();
    }
    const out = [];
    for (let i = 0; i < Math.min(t.count, 16); i++) {
      if (t.type === 3) out.push(u16(t.at + i * 2));
      else if (t.type === 4) out.push(u32(t.at + i * 4));
      else if (t.type === 1 || t.type === 7) out.push(view.getUint8(t.at + i));
      else if (t.type === 5 || t.type === 10) {
        const num = t.type === 5 ? u32(t.at + i * 8) : view.getInt32(t.at + i * 8, le);
        const den = t.type === 5 ? u32(t.at + i * 8 + 4) : view.getInt32(t.at + i * 8 + 4, le);
        out.push(den ? num / den : NaN);
      }
    }
    return out.length === 1 ? out[0] : out;
  }

  return { ifd, value, firstIfd: u32(start + 4) };
}

/** Convierte "2026:10:11 19:42:05" (+ "-05:00" opcional) a ISO. */
function exifDate(text, zone) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text || '');
  if (!m || m[1] === '0000') return undefined;
  const z = /^[+-]\d{2}:\d{2}$/.test(zone || '') ? zone : '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${z}`;
}

function gpsCoord(parts, ref, pos, neg) {
  if (!Array.isArray(parts) || parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
  // Sin hemisferio no se puede saber el signo: mejor no dar una ubicación falsa.
  const r = String(ref || '').toUpperCase();
  if (r !== pos && r !== neg) return undefined;
  const v = parts[0] + parts[1] / 60 + parts[2] / 3600;
  return r === neg ? -v : v;
}

/**
 * Lee el EXIF de un JPEG. Devuelve un objeto solo con los datos encontrados
 * ({ marca, modelo, software, fechaOriginal, gps: { lat, lon, altitud } ... })
 * o null si el archivo no es JPEG o no tiene metadatos útiles.
 */
export function readExif(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    if (marker === 0xda || marker === 0xd9) return null; // empieza la imagen: no hay EXIF
    const len = view.getUint16(p + 2);
    if (len < 2 || p + 2 + len > bytes.length) return null;
    const isExif = marker === 0xe1 && len > 8
      && bytes[p + 4] === 0x45 && bytes[p + 5] === 0x78 && bytes[p + 6] === 0x69 && bytes[p + 7] === 0x66;
    if (isExif) {
      try {
        return parseExif(view, p + 10, len - 8);
      } catch {
        return null; // EXIF dañado: se ignora, la prueba se guarda igual
      }
    }
    p += 2 + len;
  }
  return null;
}

function parseExif(view, start, length) {
  const t = readTiff(view, start, length);
  if (!t) return null;
  const out = {};
  const ifd0 = t.ifd(t.firstIfd);
  for (const [tag, key] of Object.entries(TAGS_IFD0)) {
    const v = t.value(ifd0.get(Number(tag)));
    if (typeof v === 'string' && v) out[key] = v.slice(0, 100);
  }
  const exifPtr = t.value(ifd0.get(EXIF_POINTER));
  if (typeof exifPtr === 'number') {
    const exif = t.ifd(exifPtr);
    for (const [tag, key] of Object.entries(TAGS_EXIF)) {
      const v = t.value(exif.get(Number(tag)));
      if (typeof v === 'string' && v) out[key] = v.slice(0, 100);
    }
  }
  // Solo DateTimeOriginal es la fecha de la toma; DateTime es la última edición.
  const fecha = exifDate(out.fechaOriginal, out.zonaOriginal);
  const modificada = exifDate(out.fecha);
  delete out.fecha;
  delete out.zonaOriginal;
  delete out.fechaOriginal;
  if (fecha) out.fechaOriginal = fecha;
  if (modificada) out.fechaModificacion = modificada;

  const gpsPtr = t.value(ifd0.get(GPS_POINTER));
  if (typeof gpsPtr === 'number') {
    const g = t.ifd(gpsPtr);
    const lat = gpsCoord(t.value(g.get(2)), t.value(g.get(1)), 'N', 'S');
    const lon = gpsCoord(t.value(g.get(4)), t.value(g.get(3)), 'E', 'W');
    if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) {
      out.gps = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
      const alt = t.value(g.get(6));
      if (Number.isFinite(alt)) out.gps.altitud = Math.round(alt * (t.value(g.get(5)) === 1 ? -1 : 1));
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Texto corto para mostrar en la bitácora y el informe. */
export function describeExif(m) {
  if (!m) return '';
  const parts = [];
  if (m.gps) parts.push(`GPS ${m.gps.lat}, ${m.gps.lon}`);
  const equipo = [m.marca, m.modelo].filter(Boolean).join(' ');
  if (equipo) parts.push(`equipo ${equipo}`);
  if (m.serieCamara) parts.push(`serie ${m.serieCamara}`);
  if (m.fechaOriginal) parts.push(`tomada ${m.fechaOriginal.replace('T', ' ')}`);
  if (m.software) parts.push(`software ${m.software}`);
  return parts.join(' · ');
}
