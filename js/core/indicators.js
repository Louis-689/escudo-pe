// Detecta datos útiles para la investigación dentro de lo que la víctima ya
// tiene: los textos de los mensajes, los números que la contactaron y las
// cuentas que le pidieron usar. Todo se procesa en el teléfono.
//
// Escudo NO rastrea a nadie: solo ordena información que la víctima recibió,
// para que la Policía y la Fiscalía pidan a las operadoras y bancos, con orden
// judicial, los datos que identifican a los responsables.

import { applyCorrections, claveCuenta, medioMasEspecifico } from './model.js';

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
  url: /\b(?:https?:\/\/|www\.)[^\s<>"')]+|\b(?:wa\.me|t\.me|bit\.ly|tinyurl\.com|chat\.whatsapp\.com|api\.whatsapp\.com)\/[^\s<>"')]+/gi,
  // Enlaces de WhatsApp que llevan el número: wa.me/51987654321 y api.whatsapp.com/send?phone=51987654321.
  waLink: /\bwa\.me\/\+?(\d{6,15})\b|\bapi\.whatsapp\.com\/send\/?\?(?:[^\s#]*?&)?phone=\+?(\d{6,15})\b/gi,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  handle: /(?:^|[\s(])@([A-Za-z0-9_.]{3,30})\b/g,
  // Teléfonos: +CC ..., celulares peruanos de 9 dígitos con separadores y 51 + celular sin "+".
  phone: /(?:\+|\b00)\d[\d\s.-]{6,17}\d|\b51[\s.-]?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b|\b9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g,
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

  // Tramos ya usados: un número dentro de un enlace o de un teléfono no es una cuenta.
  const span = (m) => [m.index, m.index + m[0].length];
  const overlaps = (spans, [s, e]) => spans.some(([a, b]) => s < b && a < e);
  const urlSpans = [...t.matchAll(RE.url)].map(span);
  const phoneSpans = [];
  const addPhone = (p, original) => out.telefonos.push({ valor: p.e164, pais: p.pais, tipo: p.tipo, original: original.trim() });

  // wa.me/51987654321: el número del enlace es un teléfono (siempre con código de país).
  for (const m of t.matchAll(RE.waLink)) {
    const digits = m[1] || m[2];
    const p = classifyPhone(digits.length === 9 ? digits : '+' + digits);
    if (p) {
      phoneSpans.push(span(m));
      addPhone(p, m[0]);
    }
  }

  for (const m of t.matchAll(RE.phone)) {
    if (overlaps(urlSpans, span(m))) continue;
    const p = classifyPhone(m[0]);
    if (p) {
      phoneSpans.push(span(m));
      addPhone(p, m[0]);
      // "yapea al 912..." / "plin 912...": el número también es una billetera para cobrar.
      const before = t.slice(Math.max(0, m.index - 30), m.index);
      const wallet = /\b(yape|yapea\w*|plin|plinea\w*)\b[^\n]*$/i.exec(before);
      if (wallet) out.cuentas.push({ valor: p.e164, digitos: p.e164.replace(/\D/g, ''), tipo: 'Billetera vinculada a celular', medio: /^y/i.test(wallet[1]) ? 'yape' : 'plin' });
    }
  }

  for (const m of t.matchAll(RE.account)) {
    if (overlaps(phoneSpans, span(m)) || overlaps(urlSpans, span(m))) continue;
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 20) continue;
    const tipo = digits.length === 20 ? 'CCI (cuenta interbancaria)' : 'Posible cuenta bancaria';
    out.cuentas.push({ valor: m[0].trim(), digitos: digits, tipo });
  }

  for (const [a, b] of urlSpans) out.enlaces.push({ valor: t.slice(a, b).replace(/[.,;:!?]+$/, '') });
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

// Tipos de cuenta de más a menos informativos (para la fila que junta varias menciones).
const TIPO_CUENTA_RANK = {
  'Billetera vinculada a celular': 2, 'CCI (cuenta interbancaria)': 2, 'Cuenta indicada': 1, 'Posible cuenta bancaria': 1,
};

/**
 * Consolida los indicios de toda la bitácora (con los datos ya corregidos por
 * las notas), con en cuántos incidentes aparecen, la primera y la última fecha
 * y de dónde salieron ("origenes"): "contacto" (quien escribió o llamó),
 * "cuenta de pago" (la cuenta que la víctima anotó en el formulario), "mensaje"
 * (texto del extorsionador) o "descripcion" (lo que anotó la víctima).
 * Es la base de la sección para la Fiscalía.
 */
export function consolidate(log) {
  const incidents = applyCorrections(log).filter((e) => e.tipo === 'incidente');
  const buckets = {
    telefonos: new Map(), cuentas: new Map(), enlaces: new Map(), correos: new Map(),
    perfiles: new Map(), placas: new Map(), billeteras: new Map(), riesgos: new Map(),
  };
  const vistos = new Map();
  const fotos = [];
  const add = (bucket, key, item, e, origen) => {
    const prev = buckets[bucket].get(key);
    if (prev) {
      // "veces" cuenta incidentes, no menciones: el mismo número en el contacto y en el texto es una vez.
      const ids = vistos.get(prev);
      if (!ids.has(e.id)) {
        ids.add(e.id);
        prev.veces += 1;
      }
      if (e.ocurridoEn < prev.primera) prev.primera = e.ocurridoEn;
      if (e.ocurridoEn > prev.ultima) prev.ultima = e.ocurridoEn;
      if (!prev.canales.includes(e.canal)) prev.canales.push(e.canal);
      if (!prev.origenes.includes(origen)) prev.origenes.push(origen);
      return prev;
    }
    const nuevo = { ...item, veces: 1, primera: e.ocurridoEn, ultima: e.ocurridoEn, canales: [e.canal], origenes: [origen] };
    buckets[bucket].set(key, nuevo);
    vistos.set(nuevo, new Set([e.id]));
    return nuevo;
  };
  // Las cuentas se juntan por sus dígitos: la escrita en el campo y la que aparece en el texto son una sola fila.
  const addCuenta = (c, e, origen) => {
    const fila = add('cuentas', claveCuenta(c.valor), { valor: c.valor, medio: c.medio || '', tipo: c.tipo, titular: c.titular || '' }, e, origen);
    fila.medio = medioMasEspecifico(fila.medio, c.medio || '');
    if ((TIPO_CUENTA_RANK[c.tipo] || 0) > (TIPO_CUENTA_RANK[fila.tipo] || 0)) fila.tipo = c.tipo;
    // Se muestra la cuenta tal como la anotó la víctima.
    if (origen === 'cuenta de pago') fila.valor = c.valor;
    if (c.titular && !fila.titular) fila.titular = c.titular;
  };

  for (const e of incidents) {
    const contact = classifyPhone(e.contacto);
    if (contact) add('telefonos', contact.e164, { valor: contact.e164, pais: contact.pais, tipo: contact.tipo }, e, 'contacto');
    else if (e.contacto) add('perfiles', e.contacto.toLowerCase(), { valor: e.contacto }, e, 'contacto');

    if (e.cuentaPago) {
      const p = classifyPhone(e.cuentaPago);
      addCuenta({ valor: e.cuentaPago, medio: e.medioPago || '', tipo: p ? 'Billetera vinculada a celular' : 'Cuenta indicada', titular: e.titularCuenta }, e, 'cuenta de pago');
    }
    // Solo las fotos que envió el extorsionador: el GPS de las propias fotos es la casa de la víctima.
    for (const a of e.adjuntos) {
      if (a.metadatos && a.recibida) fotos.push({ nombre: a.nombre, sha256: a.sha256, ocurridoEn: e.ocurridoEn, contacto: e.contacto, ...a.metadatos });
    }

    // "mensaje" es lo que escribió el extorsionador; "descripcion", lo que anotó la víctima
    // (puede nombrar a familiares). Se distinguen para no acusar a quien solo se menciona.
    for (const [origen, text] of [['mensaje', e.mensaje], ['descripcion', e.descripcion]]) {
      if (!text) continue;
      const found = extractIndicators(text);
      for (const t of found.telefonos) add('telefonos', t.valor, t, e, origen);
      for (const c of found.cuentas) addCuenta(c, e, origen);
      for (const k of ['enlaces', 'correos', 'perfiles', 'placas', 'billeteras', 'riesgos']) {
        for (const x of found[k]) add(k, x.valor.toLowerCase(), x, e, origen);
      }
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
