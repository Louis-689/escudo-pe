// Detecta datos útiles para la investigación dentro de lo que la víctima ya
// tiene: los textos de los mensajes, los números que la contactaron y las
// cuentas que le pidieron usar. Todo se procesa en el teléfono.
//
// Escudo NO rastrea a nadie: solo ordena información que la víctima recibió,
// para que la Policía y la Fiscalía pidan a las operadoras y bancos, con orden
// judicial, los datos que identifican a los responsables.

// Códigos de país frecuentes en casos de la región (más largos primero).
const COUNTRY_CODES = [
  ['593', 'Ecuador'], ['591', 'Bolivia'], ['595', 'Paraguay'], ['598', 'Uruguay'],
  ['507', 'Panamá'], ['506', 'Costa Rica'], ['505', 'Nicaragua'], ['504', 'Honduras'],
  ['503', 'El Salvador'], ['502', 'Guatemala'], ['509', 'Haití'], ['880', 'Bangladés'],
  ['234', 'Nigeria'], ['351', 'Portugal'],
  ['51', 'Perú'], ['57', 'Colombia'], ['58', 'Venezuela'], ['56', 'Chile'], ['54', 'Argentina'],
  ['55', 'Brasil'], ['52', 'México'], ['53', 'Cuba'], ['34', 'España'], ['39', 'Italia'],
  ['44', 'Reino Unido'], ['49', 'Alemania'], ['33', 'Francia'], ['86', 'China'], ['91', 'India'],
  ['92', 'Pakistán'], ['62', 'Indonesia'], ['63', 'Filipinas'], ['84', 'Vietnam'],
  ['1', 'EE. UU./Canadá/Caribe'], ['7', 'Rusia/Kazajistán'],
];

/** País de un número en formato internacional (solo dígitos, con código). */
export function countryOf(digits) {
  const hit = COUNTRY_CODES.find(([code]) => digits.startsWith(code));
  return hit ? hit[1] : 'Desconocido';
}

/**
 * Clasifica un número de teléfono escrito de cualquier forma.
 * Devuelve { e164, pais, tipo } o null si no parece un teléfono.
 */
export function classifyPhone(raw) {
  const text = String(raw ?? '').trim();
  const digits = text.replace(/\D/g, '');
  const intl = text.startsWith('+') || text.startsWith('00');
  const d = text.startsWith('00') ? digits.slice(2) : digits;

  if (!intl && d.length === 9 && d.startsWith('9')) return { e164: '+51' + d, pais: 'Perú', tipo: 'Celular' };
  if (!intl && /^0?1\d{7}$/.test(d)) return { e164: '+51' + d.replace(/^0/, ''), pais: 'Perú', tipo: 'Fijo (Lima)' };
  if (d.startsWith('51') && d.length === 11 && d[2] === '9') return { e164: '+' + d, pais: 'Perú', tipo: 'Celular' };
  if (intl && d.length >= 8 && d.length <= 15) {
    const pais = countryOf(d);
    return { e164: '+' + d, pais, tipo: pais === 'Perú' ? 'Fijo' : 'Extranjero' };
  }
  return null;
}

const RE = {
  url: /\b(?:https?:\/\/|www\.)[^\s<>"')]+|\b(?:wa\.me|t\.me|bit\.ly|tinyurl\.com|chat\.whatsapp\.com)\/[^\s<>"')]+/gi,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  handle: /(?:^|[\s(])@([A-Za-z0-9_.]{3,30})\b/g,
  // Teléfonos: +CC ... o celulares peruanos de 9 dígitos con separadores.
  phone: /(?:\+|\b00)\d[\d\s.-]{6,17}\d|\b9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g,
  // Secuencias largas de dígitos (cuentas bancarias, CCI).
  account: /\b\d[\d -]{8,26}\d\b/g,
  // Montos: S/ 500, 500 soles, 5 mil, $ 100, 100 dólares, USD 50.
  amount: /(?:s\/\.?|us\$|\$|usd)\s?\d[\d.,]*(?:\s?mil)?|\b\d[\d.,]*\s?(?:mil\s)?(?:soles|lucas|dólares|dolares|usd)\b|\b\d+(?:[.,]\d+)?\s?mil\b/gi,
  // Placas vehiculares peruanas (ABC-123, A1B-234) y de mototaxi (1234-AB).
  plate: /\b[A-Z][A-Z0-9]{2}-\d{3}\b|\b\d{4}-[A-Z]{2}\b/g,
  // Billeteras de criptomonedas usadas para cobrar.
  tron: /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g,
  eth: /\b0x[a-fA-F0-9]{40}\b/g,
  btc: /\b(?:bc1[ac-hj-np-z02-9]{25,60}|[13][1-9A-HJ-NP-Za-km-z]{25,34})\b/g,
};

const RISK_WORDS = [
  ['muerte', /\b(?:mat(?:ar|o|amos|aremos|en)|muert[oe]s?|plomo|bala|balear|sicari)/i],
  ['explosivos', /\b(?:explosiv|dinamita|granada|bomba|detonar)/i],
  ['familia', /\b(?:hij[oa]s?|famili|espos[ao]|mam[áa]|colegio|ni[ñn][oa]s?)/i],
  ['armas', /\b(?:arma|pistola|fierro|revólver|revolver|metralleta)/i],
  ['vigilancia', /\b(?:te (?:estamos|tenemos) (?:vigilad|ubicad|marcad)|sab(?:emos|en|e) d[oó]nde|tu casa|tu negocio|tu carro)/i],
  ['plazo', /\b(?:hoy mismo|24 horas|hasta (?:el|las)|[uú]ltimo aviso|plazo)/i],
];

const PAYMENT_WORDS = /\b(yape|plin|bcp|interbank|bbva|scotiabank|banco de la naci[oó]n|caja|tunki|agora|bim|western union|binance|usdt)\b/i;

function uniq(list) {
  return [...new Map(list.map((x) => [x.valor, x])).values()];
}

/** Extrae indicios de un texto libre. */
export function extractIndicators(text) {
  const t = String(text ?? '');
  const out = {
    telefonos: [], cuentas: [], enlaces: [], correos: [], perfiles: [],
    montos: [], placas: [], billeteras: [], riesgos: [], mediosPago: [],
  };
  if (!t.trim()) return out;

  const phoneSpans = [];
  for (const m of t.matchAll(RE.phone)) {
    const p = classifyPhone(m[0]);
    if (p) {
      phoneSpans.push([m.index, m.index + m[0].length]);
      out.telefonos.push({ valor: p.e164, pais: p.pais, tipo: p.tipo, original: m[0].trim() });
      // "yapea al 912..." / "plin 912...": el número también es una billetera para cobrar.
      const before = t.slice(Math.max(0, m.index - 30), m.index);
      const wallet = /\b(yape|yapea\w*|plin|plinea\w*)\b[^\n]*$/i.exec(before);
      if (wallet) out.cuentas.push({ valor: p.e164, digitos: p.e164, tipo: 'Billetera vinculada a celular', medio: /^y/i.test(wallet[1]) ? 'yape' : 'plin' });
    }
  }
  const insidePhone = (i) => phoneSpans.some(([a, b]) => i >= a && i < b);

  for (const m of t.matchAll(RE.account)) {
    if (insidePhone(m.index)) continue;
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 20) continue;
    const tipo = digits.length === 20 ? 'CCI (cuenta interbancaria)' : 'Posible cuenta bancaria';
    out.cuentas.push({ valor: m[0].trim(), digitos: digits, tipo });
  }

  for (const m of t.matchAll(RE.url)) out.enlaces.push({ valor: m[0].replace(/[.,;:!?]+$/, '') });
  for (const m of t.matchAll(RE.email)) out.correos.push({ valor: m[0].toLowerCase() });
  const emailText = out.correos.map((c) => c.valor).join(' ');
  for (const m of t.matchAll(RE.handle)) {
    if (!emailText.includes(m[1].toLowerCase())) out.perfiles.push({ valor: '@' + m[1] });
  }
  for (const m of t.matchAll(RE.amount)) out.montos.push({ valor: m[0].trim() });
  for (const m of t.matchAll(RE.plate)) out.placas.push({ valor: m[0] });
  for (const m of t.matchAll(RE.tron)) out.billeteras.push({ valor: m[0], red: 'TRON (USDT TRC-20)' });
  for (const m of t.matchAll(RE.eth)) out.billeteras.push({ valor: m[0], red: 'Ethereum / BSC' });
  for (const m of t.matchAll(RE.btc)) out.billeteras.push({ valor: m[0], red: 'Bitcoin' });
  for (const [label, re] of RISK_WORDS) if (re.test(t)) out.riesgos.push({ valor: label });
  for (const m of t.matchAll(new RegExp(PAYMENT_WORDS, 'gi'))) out.mediosPago.push({ valor: m[1].toLowerCase() });

  for (const k of Object.keys(out)) out[k] = uniq(out[k]);
  return out;
}

/** Texto de un registro sobre el que se buscan indicios. */
function entryText(e) {
  return [e.mensaje, e.descripcion].filter(Boolean).join('\n');
}

/**
 * Consolida los indicios de toda la bitácora, con cuántas veces aparecen,
 * la primera y la última fecha. Es la base de la sección para la Fiscalía.
 */
export function consolidate(log) {
  const incidents = log.filter((e) => e.tipo === 'incidente');
  const buckets = {
    telefonos: new Map(), cuentas: new Map(), enlaces: new Map(), correos: new Map(),
    perfiles: new Map(), placas: new Map(), billeteras: new Map(), riesgos: new Map(), titulares: new Map(),
  };
  const fotos = [];
  const add = (bucket, key, item, e, origen) => {
    const prev = buckets[bucket].get(key);
    if (prev) {
      prev.veces += 1;
      if (e.ocurridoEn < prev.primera) prev.primera = e.ocurridoEn;
      if (e.ocurridoEn > prev.ultima) prev.ultima = e.ocurridoEn;
      if (!prev.canales.includes(e.canal)) prev.canales.push(e.canal);
      if (!prev.origenes.includes(origen)) prev.origenes.push(origen);
    } else {
      buckets[bucket].set(key, { ...item, veces: 1, primera: e.ocurridoEn, ultima: e.ocurridoEn, canales: [e.canal], origenes: [origen] });
    }
  };

  for (const e of incidents) {
    const contact = classifyPhone(e.contacto);
    if (contact) add('telefonos', contact.e164, { valor: contact.e164, pais: contact.pais, tipo: contact.tipo }, e, 'contacto');
    else if (e.contacto) add('perfiles', e.contacto, { valor: e.contacto }, e, 'contacto');

    if (e.cuentaPago) {
      const p = classifyPhone(e.cuentaPago);
      const medio = e.medioPago || 'otro';
      const key = (p ? p.e164 : e.cuentaPago.replace(/\s/g, '')) + '|' + medio;
      add('cuentas', key, { valor: e.cuentaPago, medio, tipo: p ? 'Billetera vinculada a celular' : 'Cuenta indicada', titular: e.titularCuenta || '' }, e, 'cuenta de pago');
      const prev = buckets.cuentas.get(key);
      if (e.titularCuenta && !prev.titular) prev.titular = e.titularCuenta;
    }
    if (e.titularCuenta) {
      add('titulares', e.titularCuenta.toLowerCase(), { valor: e.titularCuenta, cuenta: e.cuentaPago, medio: e.medioPago || '' }, e, 'titular');
    }
    for (const a of e.adjuntos) {
      if (a.metadatos) fotos.push({ nombre: a.nombre, sha256: a.sha256, ocurridoEn: e.ocurridoEn, contacto: e.contacto, ...a.metadatos });
    }

    const found = extractIndicators(entryText(e));
    for (const t of found.telefonos) add('telefonos', t.valor, t, e, 'mensaje');
    for (const c of found.cuentas) add('cuentas', c.digitos + '|' + (c.medio || ''), { valor: c.valor, medio: c.medio || '', tipo: c.tipo }, e, 'mensaje');
    for (const k of ['enlaces', 'correos', 'perfiles', 'placas', 'billeteras', 'riesgos']) {
      for (const x of found[k]) add(k, x.valor.toLowerCase(), x, e, 'mensaje');
    }
  }

  const result = {};
  for (const [k, map] of Object.entries(buckets)) {
    result[k] = [...map.values()].sort((a, b) => b.veces - a.veces || a.primera.localeCompare(b.primera));
  }
  // Primero las fotos con GPS: son las que pueden ubicar a quien las tomó.
  result.fotos = fotos.sort((a, b) => Number(Boolean(b.gps)) - Number(Boolean(a.gps)) || a.ocurridoEn.localeCompare(b.ocurridoEn));
  return result;
}
