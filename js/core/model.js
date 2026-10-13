// Modelo de datos de la bitácora: validación, normalización y cadena de huellas.
//
// La bitácora es de solo agregar: un registro nunca se edita ni se borra.
// Para corregir algo se agrega una "nota" que apunta al registro original.
// Cada registro guarda la huella del anterior, así cualquier cambio posterior
// (editar, borrar o reordenar) rompe la cadena y se detecta con verifyChain().

import { sha256Hex, randomBytes, toHex } from './crypto.js';

export const CANALES = {
  llamada: 'Llamada telefónica',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  redes: 'Redes sociales (Facebook, TikTok, etc.)',
  presencial: 'En persona',
  nota: 'Nota o carta física',
  otro: 'Otro',
};

export const MEDIOS_PAGO = {
  '': 'No indicaron',
  yape: 'Yape',
  plin: 'Plin',
  cuenta_bancaria: 'Cuenta bancaria',
  efectivo: 'Efectivo',
  otro: 'Otro',
};

export const MONEDAS = { PEN: 'Soles (S/)', USD: 'Dólares (US$)' };

export const TIPOS = { incidente: 'Incidente', nota: 'Nota o corrección', custodia: 'Evento de custodia' };

// Datos de un incidente que una nota puede corregir. El registro original no
// cambia (la cadena de huellas lo protege): la corrección queda en la nota y
// los informes muestran el dato corregido junto con la fecha de la corrección.
// El pago ya hecho ("pago") no se corrige así: un error se aclara con una nota libre.
export const CAMPOS_CORREGIBLES = {
  contacto: 'Número o perfil que contactó',
  cuentaPago: 'Cuenta, Yape o Plin para pagar',
  medioPago: 'Medio de pago',
  titularCuenta: 'Titular que muestra la app',
  montoExigido: 'Monto exigido',
  moneda: 'Moneda',
};

// Eventos de cadena de custodia: quedan en la bitácora encadenada, así se sabe
// cuándo se exportaron, verificaron o restauraron las pruebas.
export const EVENTOS_CUSTODIA = {
  creacion: 'Creación de la bitácora',
  verificacion: 'Verificación de integridad',
  informe: 'Generación del informe',
  paquete: 'Generación del paquete de pruebas',
  copia: 'Copia de seguridad cifrada',
  restauracion: 'Restauración desde copia',
  importacion: 'Importación de chat de WhatsApp',
  contrasena: 'Cambio de contraseña',
  denuncia: 'Generación del escrito de denuncia',
  ampliacion: 'Generación del escrito de ampliación de denuncia',
};

// Margen para relojes de celular desajustados.
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

export function newId() {
  return toHex(randomBytes(8));
}

/**
 * Normaliza un número telefónico peruano.
 * Devuelve { valor, esCelularPeru }. Si no parece un teléfono, devuelve el texto limpio.
 */
export function normalizePhone(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { valor: '', esCelularPeru: false };
  const hasPlus = text.startsWith('+');
  const digits = text.replace(/\D/g, '');
  if (digits.length < 6 || /[a-z@]/i.test(text)) {
    return { valor: text, esCelularPeru: false };
  }
  if (digits.length === 9 && digits.startsWith('9')) {
    return { valor: `+51 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`, esCelularPeru: true };
  }
  if (digits.length === 11 && digits.startsWith('519')) {
    const d = digits.slice(2);
    return { valor: `+51 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`, esCelularPeru: true };
  }
  return { valor: hasPlus ? `+${digits}` : digits, esCelularPeru: false };
}

// Monedas que se reconocen al escribir un monto. "lucas" es soles en jerga.
const USD_RE = /us\$|usd|d[oó]lar(?:es)?|\$/;
const PEN_RE = /s\/\.?|soles?|lucas?|pen/;
const USD_ALL = new RegExp(USD_RE.source, 'g');
const PEN_ALL = new RegExp(PEN_RE.source, 'g');

/** Moneda escrita junto al monto: 'USD', 'PEN' o null si no se indicó. */
function currencyIn(text) {
  const t = String(text ?? '').toLowerCase();
  if (USD_RE.test(t)) return 'USD';
  return PEN_RE.test(t) ? 'PEN' : null;
}

/**
 * Convierte un monto escrito por la persona ("S/ 1,500.50", "2 mil", "1.500", "$ 300") a número.
 * Devuelve null si está vacío y NaN si no se entiende. La moneda la da parseMoney().
 */
export function parseAmount(raw) {
  let text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  text = text.replace(USD_ALL, '').replace(PEN_ALL, '').replace(/\s+/g, ' ').trim();
  if (!text) return NaN;

  const mil = text.match(/^(\d+(?:[.,]\d+)?)\s*(mil|k)$/);
  if (mil) return Math.round(Number(mil[1].replace(',', '.')) * 1000 * 100) / 100;

  text = text.replace(/\s/g, '');
  if (!/^[\d.,]+$/.test(text)) return NaN;

  if (text.includes('.') && text.includes(',')) {
    // El separador que aparece al final es el decimal.
    text = text.lastIndexOf('.') > text.lastIndexOf(',')
      ? text.replace(/,/g, '')
      : text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes(',')) {
    text = /^\d+,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Monto y moneda: "$ 500", "US$ 500", "500 dólares" y "USD 500" son dólares;
 * "S/ 500", "500 soles", "500 lucas" o un número solo, soles (o la moneda por defecto).
 * Devuelve { monto, moneda: 'PEN' | 'USD' }; monto es null si está vacío y NaN si no se entiende.
 */
export function parseMoney(raw, monedaPorDefecto = 'PEN') {
  const escrita = currencyIn(raw);
  const moneda = escrita || (monedaPorDefecto === 'USD' ? 'USD' : 'PEN');
  return { monto: parseAmount(raw), moneda };
}

export function formatSoles(amount) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '';
  return 'S/ ' + amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Monto con su moneda ("S/ 1,500.00" o "US$ 500.00"). Los registros sin moneda son soles. */
export function formatMoney(amount, moneda = 'PEN') {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return '';
  if (moneda !== 'USD') return formatSoles(amount);
  return 'US$ ' + amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Nombre del medio de pago para una cuenta. Nunca "No indicaron": sin medio claro es "Cuenta". */
export function etiquetaMedio(medio) {
  return medio && medio !== 'otro' && has(MEDIOS_PAGO, medio) ? MEDIOS_PAGO[medio] : 'Cuenta';
}

// Billeteras de criptomonedas o alias: letras y números en un solo bloque largo.
const WALLET_LIKE = /^[a-z0-9]{20,}$/i;

/**
 * Clave para reconocer la misma cuenta escrita de distintas formas: solo los
 * dígitos ("191-1234..." y "1911234..." son la misma). Los celulares (Yape,
 * Plin) se llevan a 51 + 9 dígitos y las billeteras cripto se comparan tal cual.
 */
export function claveCuenta(valor) {
  const text = String(valor ?? '').trim();
  if (WALLET_LIKE.test(text) && /[a-z]/i.test(text)) return text.toLowerCase();
  const digits = text.replace(/\D/g, '');
  if (/^9\d{8}$/.test(digits)) return '51' + digits;
  if (digits.length >= 6) return digits;
  return text.toLowerCase().replace(/\s+/g, ' ');
}

const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/** Errores de la corrección estructurada de una nota (campo "corrige"). */
function validateCorrection(corrige, errors) {
  if (corrige === undefined || corrige === null) return;
  if (!isPlainObject(corrige)) {
    errors.push('La corrección no es válida.');
    return;
  }
  for (const [k, v] of Object.entries(corrige)) {
    if (!has(CAMPOS_CORREGIBLES, k)) errors.push(`No se puede corregir el dato "${String(k).slice(0, 40)}".`);
    else if (typeof v !== 'string') errors.push(`El dato corregido "${CAMPOS_CORREGIBLES[k]}" debe ser texto.`);
  }
  if (typeof corrige.medioPago === 'string' && corrige.medioPago && !has(MEDIOS_PAGO, corrige.medioPago)) {
    errors.push('Medio de pago no válido.');
  }
  if (typeof corrige.moneda === 'string' && !has(MONEDAS, corrige.moneda)) errors.push('Moneda no válida.');
  if (typeof corrige.montoExigido === 'string') {
    const monto = parseAmount(corrige.montoExigido);
    if (Number.isNaN(monto)) errors.push('No se entiende el monto corregido. Escríbelo solo con números, por ejemplo 1500.');
    else if (monto !== null && monto < 0) errors.push('El monto no puede ser negativo.');
  }
}

/** Corrección ya validada, con los datos normalizados como en un incidente. */
function normalizeCorrection(corrige) {
  if (!isPlainObject(corrige)) return null;
  const out = {};
  if (has(corrige, 'contacto')) out.contacto = normalizePhone(corrige.contacto).valor;
  if (has(corrige, 'cuentaPago')) out.cuentaPago = String(corrige.cuentaPago).trim();
  if (has(corrige, 'medioPago')) out.medioPago = corrige.medioPago;
  if (has(corrige, 'titularCuenta')) out.titularCuenta = String(corrige.titularCuenta).trim().slice(0, 120);
  if (has(corrige, 'montoExigido')) {
    out.montoExigido = parseAmount(corrige.montoExigido);
    // "$ 500" corrige también la moneda; un número solo mantiene la del registro.
    const escrita = currencyIn(corrige.montoExigido);
    if (escrita && out.montoExigido !== null) out.moneda = escrita;
  }
  if (has(corrige, 'moneda')) out.moneda = corrige.moneda;
  return Object.keys(out).length ? out : null;
}

// Pago ya hecho ("Ya pagué, aunque sea una parte"). Muchas víctimas llegan
// después de pagar una vez: la operación es la mejor pista para seguir el
// dinero (cuenta receptora, retiros, transferencias). Es opcional y queda
// dentro de la cadena de huellas; un bloque vacío del formulario no cuenta.
const CAMPOS_PAGO = ['monto', 'fecha', 'medio', 'cuenta', 'operacion'];
const MAX_CUENTA_PAGADA = 80;
const MAX_OPERACION = 60;
const FECHA_MINIMA = Date.UTC(2000, 0, 1);

const textoPago = (v) => String(v ?? '').trim();

/** true si el formulario trae algún dato del pago. */
function hayPago(pago) {
  return isPlainObject(pago) && CAMPOS_PAGO.some((k) => textoPago(pago[k]));
}

/** Pago guardado con la forma esperada (los registros importados se revisan otra vez). */
export function pagoValido(pago) {
  return isPlainObject(pago) && typeof pago.monto === 'number' && Number.isFinite(pago.monto) && pago.monto > 0;
}

/** Errores del bloque de pago de un incidente. */
function validatePago(pago, now, errors) {
  if (pago === undefined || pago === null) return;
  if (!isPlainObject(pago)) {
    errors.push('Los datos del pago no son válidos.');
    return;
  }
  if (!hayPago(pago)) return;
  const { monto } = parseMoney(textoPago(pago.monto));
  if (monto === null) errors.push('Indica cuánto pagaste.');
  else if (Number.isNaN(monto)) errors.push('No se entiende el monto pagado. Escríbelo solo con números, por ejemplo 500.');
  else if (!(monto > 0)) errors.push('El monto pagado debe ser mayor que cero.');

  const fecha = textoPago(pago.fecha);
  const when = fecha ? new Date(fecha).getTime() : NaN;
  if (Number.isNaN(when) || when < FECHA_MINIMA) errors.push('Indica la fecha y hora del pago.');
  else if (when > now.getTime() + FUTURE_TOLERANCE_MS) errors.push('La fecha del pago no puede estar en el futuro.');

  if (!has(MEDIOS_PAGO, pago.medio ?? '')) errors.push('Medio del pago no válido.');
  if (textoPago(pago.cuenta).length > MAX_CUENTA_PAGADA) {
    errors.push(`La cuenta a la que pagaste es muy larga (máximo ${MAX_CUENTA_PAGADA} caracteres).`);
  }
  if (textoPago(pago.operacion).length > MAX_OPERACION) {
    errors.push(`El código de operación es muy largo (máximo ${MAX_OPERACION} caracteres).`);
  }
}

/** Pago ya validado, con la forma que se guarda, o null si no se indicó. */
function normalizePago(pago) {
  if (!hayPago(pago)) return null;
  const dinero = parseMoney(textoPago(pago.monto));
  return {
    monto: dinero.monto,
    // Sin "moneda" son soles, como en montoExigido.
    ...(dinero.moneda === 'USD' ? { moneda: 'USD' } : {}),
    fecha: new Date(textoPago(pago.fecha)).toISOString(),
    medio: pago.medio || '',
    cuenta: textoPago(pago.cuenta),
    operacion: textoPago(pago.operacion),
  };
}

/** Valida los datos que escribe la persona. Devuelve una lista de errores en español. */
export function validateIncident(input, now = new Date()) {
  const errors = [];
  const tipo = input.tipo || 'incidente';
  if (!has(TIPOS, tipo)) errors.push('Tipo de registro no válido.');

  if (tipo === 'custodia') {
    if (!has(EVENTOS_CUSTODIA, input.evento)) errors.push('Evento de custodia no válido.');
    return errors;
  }

  if (tipo === 'nota') {
    if (!input.refiereA) errors.push('La nota debe indicar a qué registro corrige.');
    const antes = errors.length;
    validateCorrection(input.corrige, errors);
    // Una corrección estructurada puede ir sin texto; una nota libre, no.
    const corrige = errors.length === antes && normalizeCorrection(input.corrige);
    if (!corrige && !String(input.descripcion ?? '').trim()) errors.push('Escribe el contenido de la nota.');
    return errors;
  }

  const when = new Date(input.ocurridoEn);
  if (!input.ocurridoEn || Number.isNaN(when.getTime())) {
    errors.push('Indica la fecha y hora en que ocurrió.');
  } else if (when.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    errors.push('La fecha no puede estar en el futuro.');
  }
  if (!has(CANALES, input.canal)) errors.push('Elige cómo te contactaron.');
  if (input.medioPago && !has(MEDIOS_PAGO, input.medioPago)) errors.push('Medio de pago no válido.');
  if (input.moneda && !has(MONEDAS, input.moneda)) errors.push('Moneda no válida.');

  const monto = parseAmount(input.montoExigido);
  if (Number.isNaN(monto)) errors.push('No se entiende el monto. Escríbelo solo con números, por ejemplo 1500.');
  else if (monto !== null && monto < 0) errors.push('El monto no puede ser negativo.');
  validatePago(input.pago, now, errors);

  // Un pago anotado también es contenido: puede registrarse solo con sus datos.
  const hasContent = String(input.mensaje ?? '').trim() || String(input.descripcion ?? '').trim()
    || (input.adjuntos && input.adjuntos.length) || hayPago(input.pago);
  if (!hasContent) errors.push('Copia el mensaje, describe lo ocurrido o adjunta una prueba.');
  return errors;
}

/** Crea un registro limpio (sin huellas aún) a partir de datos ya validados. */
export function createEntry(input, now = new Date()) {
  const errors = validateIncident(input, now);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.errors = errors;
    throw err;
  }
  const tipo = input.tipo || 'incidente';
  const base = {
    id: input.id || newId(),
    tipo,
    registradoEn: now.toISOString(),
    descripcion: String(input.descripcion ?? '').trim(),
  };
  if (tipo === 'nota') {
    // "corrige" solo se agrega si hay algo que corregir: las notas antiguas no lo tienen.
    const corrige = normalizeCorrection(input.corrige);
    return { ...base, refiereA: input.refiereA, ...(corrige ? { corrige } : {}) };
  }
  if (tipo === 'custodia') {
    return { ...base, evento: input.evento, dispositivo: String(input.dispositivo ?? '').slice(0, 300) };
  }

  const contacto = normalizePhone(input.contacto);
  const dinero = parseMoney(input.montoExigido, input.moneda);
  const huellasChat = (Array.isArray(input.huellasChat) ? input.huellasChat : [])
    .filter((h) => typeof h === 'string' && /^[0-9a-f]{16}$/.test(h)).slice(0, 5000);
  const pago = normalizePago(input.pago);
  return {
    ...base,
    ocurridoEn: new Date(input.ocurridoEn).toISOString(),
    canal: input.canal,
    contacto: contacto.valor,
    montoExigido: dinero.monto,
    // Sin "moneda" son soles, como en los registros de versiones anteriores.
    ...(dinero.moneda === 'USD' && dinero.monto !== null ? { moneda: 'USD' } : {}),
    medioPago: input.medioPago || '',
    cuentaPago: String(input.cuentaPago ?? '').trim(),
    titularCuenta: String(input.titularCuenta ?? '').trim().slice(0, 120) || undefined,
    mensaje: String(input.mensaje ?? '').trim(),
    adjuntos: (input.adjuntos || []).map((a) => ({
      id: a.id, nombre: a.nombre, tipo: a.tipo, tamano: a.tamano, sha256: a.sha256,
      ...(a.metadatos ? { metadatos: a.metadatos } : {}),
      ...(a.recibida ? { recibida: true } : {}),
    })),
    // Huellas de los mensajes importados de un chat: evitan duplicarlos al reimportar.
    ...(huellasChat.length ? { huellasChat } : {}),
    // "pago" solo se agrega si se indicó: los registros sin pago dan la misma huella que antes.
    ...(pago ? { pago } : {}),
  };
}

/** JSON con las claves ordenadas, para que la huella no dependa del orden. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export const GENESIS = '0'.repeat(64);

function withoutChain(entry) {
  const { huella, huellaPrevia, ...rest } = entry;
  return rest;
}

/** Agrega un registro al final de la bitácora y calcula su huella encadenada. */
export async function appendEntry(log, entry) {
  const huellaPrevia = log.length ? log[log.length - 1].huella : GENESIS;
  const huella = await sha256Hex(huellaPrevia + canonicalJson(withoutChain(entry)));
  return [...log, { ...withoutChain(entry), huellaPrevia, huella }];
}

/** Revisa toda la cadena. Devuelve { ok, rotoEn } con el índice del primer registro alterado. */
export async function verifyChain(log) {
  let prev = GENESIS;
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    const expected = await sha256Hex(prev + canonicalJson(withoutChain(entry)));
    if (entry.huellaPrevia !== prev || entry.huella !== expected) return { ok: false, rotoEn: i };
    prev = entry.huella;
  }
  return { ok: true, rotoEn: -1 };
}

/** El medio de pago más específico de los dos ("yape" gana a "otro", y "otro" a ""). */
export function medioMasEspecifico(a = '', b = '') {
  const rank = (m) => (!m ? 0 : m === 'otro' ? 1 : 2);
  return rank(b) > rank(a) ? b : a;
}

// Valor guardado en una corrección que se puede aplicar (las notas importadas
// de una copia se revisan otra vez: nunca se confía en su forma).
function correctionValue(campo, v) {
  if (campo === 'montoExigido') return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (campo === 'medioPago') return typeof v === 'string' && has(MEDIOS_PAGO, v);
  if (campo === 'moneda') return has(MONEDAS, v);
  return typeof v === 'string';
}

/**
 * Aplica las correcciones de las notas a los incidentes. Devuelve una bitácora
 * nueva con los datos corregidos; los registros originales no se tocan (siguen
 * verificando su huella). Cada incidente corregido lleva "corregido":
 * { campo: { fecha, anterior } }, con la fecha de la última corrección y el
 * valor del registro original. Las correcciones se aplican en orden.
 */
export function applyCorrections(log) {
  const porIncidente = new Map();
  for (const n of log) {
    if (n.tipo !== 'nota' || !isPlainObject(n.corrige)) continue;
    if (!porIncidente.has(n.refiereA)) porIncidente.set(n.refiereA, []);
    porIncidente.get(n.refiereA).push(n);
  }
  if (!porIncidente.size) return log;
  return log.map((e) => {
    const notas = e.tipo === 'incidente' && porIncidente.get(e.id);
    if (!notas) return e;
    const out = { ...e };
    const corregido = { ...(e.corregido || {}) };
    for (const n of notas) {
      for (const campo of Object.keys(CAMPOS_CORREGIBLES)) {
        if (!has(n.corrige, campo) || !correctionValue(campo, n.corrige[campo])) continue;
        const v = n.corrige[campo];
        // Si ya se aplicó antes (la función se puede llamar dos veces), se conserva el valor original.
        const anterior = corregido[campo] ? corregido[campo].anterior : (campo === 'moneda' ? (e.moneda || 'PEN') : e[campo]);
        corregido[campo] = { fecha: n.registradoEn, anterior: anterior ?? '' };
        if (campo === 'moneda') {
          if (v === 'USD') out.moneda = 'USD';
          else delete out.moneda;
        } else {
          out[campo] = v;
        }
      }
    }
    if (Object.keys(corregido).length) out.corregido = corregido;
    return out;
  });
}

/** Texto de una corrección: "Monto exigido: US$ 500.00; Medio de pago: Plin". */
export function describeCorrection(corrige, monedaRegistro = 'PEN') {
  if (!isPlainObject(corrige)) return '';
  const parts = [];
  for (const campo of Object.keys(CAMPOS_CORREGIBLES)) {
    if (!has(corrige, campo) || !correctionValue(campo, corrige[campo])) continue;
    const v = corrige[campo];
    let texto;
    if (campo === 'montoExigido') texto = v === null ? '(sin monto)' : formatMoney(v, corrige.moneda || monedaRegistro);
    else if (campo === 'moneda') {
      if (has(corrige, 'montoExigido')) continue;
      texto = MONEDAS[v];
    } else if (campo === 'medioPago') texto = v ? MEDIOS_PAGO[v] : '(sin dato)';
    else texto = v || '(sin dato)';
    parts.push(`${CAMPOS_CORREGIBLES[campo]}: ${texto}`);
  }
  return parts.join('; ');
}

/** Resumen útil para la policía: números, cuentas y montos que se repiten (con los datos corregidos). */
export function summarize(log) {
  const incidents = applyCorrections(log).filter((e) => e.tipo === 'incidente');
  const count = (pick) => {
    const map = new Map();
    for (const e of incidents) {
      const key = pick(e);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([valor, veces]) => ({ valor, veces }));
  };
  // La misma cuenta escrita de distintas formas cuenta una sola vez, con el medio más específico.
  const cuentas = new Map();
  for (const e of incidents) {
    if (!e.cuentaPago) continue;
    const key = claveCuenta(e.cuentaPago);
    const prev = cuentas.get(key) || { cuenta: e.cuentaPago, medio: '', veces: 0 };
    prev.medio = medioMasEspecifico(prev.medio, e.medioPago);
    prev.veces += 1;
    cuentas.set(key, prev);
  }
  const montos = (usd) => incidents
    .filter((e) => typeof e.montoExigido === 'number' && (e.moneda === 'USD') === usd)
    .map((e) => e.montoExigido);
  const soles = montos(false);
  const dolares = montos(true);
  // Lo que la víctima ya pagó, sumado por moneda (centavos redondeados).
  const pagado = (usd) => incidents
    .filter((e) => pagoValido(e.pago) && (e.pago.moneda === 'USD') === usd)
    .map((e) => e.pago.monto);
  const total = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  const pagadoSoles = pagado(false);
  const pagadoUSD = pagado(true);
  const fechas = incidents.map((e) => e.ocurridoEn).sort();
  return {
    totalIncidentes: incidents.length,
    totalNotas: log.filter((e) => e.tipo === 'nota').length,
    totalAdjuntos: incidents.reduce((n, e) => n + e.adjuntos.length, 0),
    primerIncidente: fechas[0] || null,
    ultimoIncidente: fechas[fechas.length - 1] || null,
    montoMaximo: soles.length ? Math.max(...soles) : null,
    ...(dolares.length ? { montoMaximoUSD: Math.max(...dolares) } : {}),
    // Solo si hay pagos anotados: los resúmenes sin pagos no cambian.
    ...(pagadoSoles.length ? { totalPagado: total(pagadoSoles) } : {}),
    ...(pagadoUSD.length ? { totalPagadoUSD: total(pagadoUSD) } : {}),
    contactos: count((e) => e.contacto),
    cuentas: [...cuentas.values()].sort((a, b) => b.veces - a.veces)
      .map((c) => ({ valor: `${etiquetaMedio(c.medio)}: ${c.cuenta}`, veces: c.veces })),
    canales: count((e) => CANALES[e.canal]),
  };
}
