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

export const TIPOS = { incidente: 'Incidente', nota: 'Nota o corrección', custodia: 'Evento de custodia' };

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

/**
 * Convierte un monto escrito por la persona ("S/ 1,500.50", "2 mil", "1.500") a número.
 * Devuelve null si está vacío y NaN si no se entiende.
 */
export function parseAmount(raw) {
  let text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  text = text.replace(/s\/\.?|soles?|pen/g, '').replace(/\s+/g, ' ').trim();

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

export function formatSoles(amount) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '';
  return 'S/ ' + amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

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
    if (!String(input.descripcion ?? '').trim()) errors.push('Escribe el contenido de la nota.');
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

  const monto = parseAmount(input.montoExigido);
  if (Number.isNaN(monto)) errors.push('No se entiende el monto. Escríbelo solo con números, por ejemplo 1500.');
  else if (monto !== null && monto < 0) errors.push('El monto no puede ser negativo.');

  const hasContent = String(input.mensaje ?? '').trim() || String(input.descripcion ?? '').trim()
    || (input.adjuntos && input.adjuntos.length);
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
  if (tipo === 'nota') return { ...base, refiereA: input.refiereA };
  if (tipo === 'custodia') {
    return { ...base, evento: input.evento, dispositivo: String(input.dispositivo ?? '').slice(0, 300) };
  }

  const contacto = normalizePhone(input.contacto);
  return {
    ...base,
    ocurridoEn: new Date(input.ocurridoEn).toISOString(),
    canal: input.canal,
    contacto: contacto.valor,
    montoExigido: parseAmount(input.montoExigido),
    medioPago: input.medioPago || '',
    cuentaPago: String(input.cuentaPago ?? '').trim(),
    titularCuenta: String(input.titularCuenta ?? '').trim().slice(0, 120) || undefined,
    mensaje: String(input.mensaje ?? '').trim(),
    adjuntos: (input.adjuntos || []).map((a) => ({
      id: a.id, nombre: a.nombre, tipo: a.tipo, tamano: a.tamano, sha256: a.sha256,
      ...(a.metadatos ? { metadatos: a.metadatos } : {}),
      ...(a.recibida ? { recibida: true } : {}),
    })),
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

/** Resumen útil para la policía: números, cuentas y montos que se repiten. */
export function summarize(log) {
  const incidents = log.filter((e) => e.tipo === 'incidente');
  const count = (pick) => {
    const map = new Map();
    for (const e of incidents) {
      const key = pick(e);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([valor, veces]) => ({ valor, veces }));
  };
  const montos = incidents.map((e) => e.montoExigido).filter((m) => typeof m === 'number');
  const fechas = incidents.map((e) => e.ocurridoEn).sort();
  return {
    totalIncidentes: incidents.length,
    totalNotas: log.filter((e) => e.tipo === 'nota').length,
    totalAdjuntos: incidents.reduce((n, e) => n + e.adjuntos.length, 0),
    primerIncidente: fechas[0] || null,
    ultimoIncidente: fechas[fechas.length - 1] || null,
    montoMaximo: montos.length ? Math.max(...montos) : null,
    contactos: count((e) => e.contacto),
    cuentas: count((e) => (e.cuentaPago ? `${MEDIOS_PAGO[e.medioPago] || 'Cuenta'}: ${e.cuentaPago}` : '')),
    canales: count((e) => CANALES[e.canal]),
  };
}
