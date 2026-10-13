// Ficha conjunta: los números y las cuentas de quienes extorsionan, sin nada
// que identifique a la víctima.
//
// La extorsión es en serie: las mismas líneas y cuentas Yape amenazan a todos
// los choferes de una ruta o a todos los puestos de un mercado, pero cada
// víctima denuncia sola. Sin servidor, las víctimas que se conocen pueden
// intercambiar en persona una "ficha" (archivo o código QR) con solo esos
// identificadores. Escudo muestra las coincidencias y la denuncia pide a la
// Fiscalía que junte los casos.
//
// La ficha NUNCA lleva el texto de los mensajes, las descripciones, los
// adjuntos, las notas, los números que solo se mencionan en los mensajes ni el
// celular de la víctima: solo el número que contactó (campo "contacto") y la
// cuenta que la víctima anotó para el pago (campo "cuentaPago"). Lo que llega
// de otra persona se trata como dato no confiable y se valida entero.

import { applyCorrections, claveCuenta, medioMasEspecifico } from './model.js';
import { classifyPhone } from './indicators.js';
import { qrVersionFor } from './qr.js';

export const FICHA_FORMATO = 'escudo-ficha/1';
export const FICHA_EXTENSION = '.escudo-ficha';
export const FICHA_MAX_IDENTIFICADORES = 200;
// Lo más grande que se acepta como ficha (archivo JSON o texto del QR).
export const FICHA_MAX_CARACTERES = 64 * 1024;

const PREFIJO_QR = 'EF1:';
// Medios de pago de la ficha: es un formato de intercambio, no cambia con la app.
// Un medio que no esté aquí viaja como "otro".
const MEDIOS = ['yape', 'plin', 'cuenta_bancaria', 'efectivo', 'otro'];
const CAMPOS = new Set(['tipo', 'valor', 'medio', 'titular', 'primera', 'ultima', 'veces']);
const MAX_VECES = 10000;

const RE_TELEFONO = /^\+[1-9]\d{7,14}$/;
const RE_CUENTA = /^\d{6,24}$/;
// Billeteras cripto: claveCuenta() las deja en minúsculas.
const RE_BILLETERA = /^(?=[a-z0-9]*[a-z])[a-z0-9]{20,100}$/;
// Nombre que muestra la app de pago ("Juan Pér*", "Inversiones X S.A.C.").
const RE_TITULAR = /^[\p{L}\p{M}\d][\p{L}\p{M}\d .,'’*&-]{0,79}$/u;

const ERR = {
  noEs: 'No es una ficha de Escudo.',
  danada: 'La ficha está dañada o incompleta. Pide que te la vuelvan a pasar.',
  nueva: 'Esta ficha es de una versión más nueva de Escudo. Actualiza la aplicación para abrirla.',
  grande: 'El archivo es demasiado grande para ser una ficha de Escudo.',
  vacia: 'La ficha no tiene números ni cuentas.',
  muchos: `La ficha tiene más de ${FICHA_MAX_IDENTIFICADORES} números y cuentas.`,
  extra: 'La ficha trae datos que Escudo no acepta: solo puede tener números y cuentas.',
  tipo: 'La ficha tiene un dato que no es ni número ni cuenta.',
  telefono: 'La ficha tiene un número de teléfono no válido.',
  cuenta: 'La ficha tiene una cuenta no válida.',
  medio: 'La ficha tiene un medio de pago no válido.',
  titular: 'La ficha tiene un nombre de titular no válido.',
  fecha: 'La ficha tiene una fecha no válida.',
  futuro: 'La ficha tiene fechas posteriores a hoy. Revisa la fecha de este celular y la del celular de quien la generó.',
  veces: 'La ficha tiene un número de veces no válido.',
  repetido: 'La ficha repite el mismo número o cuenta.',
};
const falla = (clave) => new Error(ERR[clave]);

const esObjeto = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x)
  && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const utf8 = (t) => new TextEncoder().encode(t);

// ---------- Fechas (solo el día, hora de Lima) ----------

const DIA = 86400000;
const EPOCA = Date.UTC(2000, 0, 1);
// Perú está en UTC−5 todo el año (sin horario de verano desde 1994).
const LIMA = 5 * 3600 * 1000;

/** Día "AAAA-MM-DD" en Lima de un instante, o '' si no es una fecha usable. */
function fechaLima(instante) {
  const ms = new Date(instante).getTime() - LIMA;
  if (!Number.isFinite(ms) || ms < EPOCA || ms >= EPOCA + 65536 * DIA) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/** Días desde el 1/1/2000 (cabe en 16 bits hasta el año 2179). */
const diaDe = (fecha) => (Date.parse(fecha + 'T00:00:00Z') - EPOCA) / DIA;
const fechaDe = (dia) => new Date(EPOCA + dia * DIA).toISOString().slice(0, 10);

function validarFecha(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw falla('fecha');
  const ms = Date.parse(v + 'T00:00:00Z');
  // "2026-02-30" no existe: al convertirlo y volver no da lo mismo.
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== v) throw falla('fecha');
  const dia = diaDe(v);
  if (dia < 0 || dia > 65535) throw falla('fecha');
  return v;
}

const fechaCorta = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

// ---------- Validación ----------

function limpiarTitular(t) {
  const s = String(t ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return RE_TITULAR.test(s) && utf8(s).length <= 160 ? s : '';
}

function validarIdentificador(x) {
  if (!esObjeto(x)) throw falla('danada');
  for (const k of Object.keys(x)) if (!CAMPOS.has(k)) throw falla('extra');
  const out = { tipo: x.tipo, valor: x.valor };
  if (x.tipo === 'telefono') {
    if (typeof x.valor !== 'string' || !RE_TELEFONO.test(x.valor)) throw falla('telefono');
    const p = classifyPhone(x.valor);
    if (!p || p.e164 !== x.valor) throw falla('telefono');
    if (has(x, 'medio') || has(x, 'titular')) throw falla('extra');
  } else if (x.tipo === 'cuenta') {
    if (typeof x.valor !== 'string' || !(RE_CUENTA.test(x.valor) || RE_BILLETERA.test(x.valor))) throw falla('cuenta');
    // Debe venir ya normalizada: "987654321" se escribe "51987654321".
    if (claveCuenta(x.valor) !== x.valor) throw falla('cuenta');
    if (has(x, 'medio')) {
      if (!MEDIOS.includes(x.medio)) throw falla('medio');
      out.medio = x.medio;
    }
    if (has(x, 'titular')) {
      if (typeof x.titular !== 'string' || !x.titular || limpiarTitular(x.titular) !== x.titular) throw falla('titular');
      out.titular = x.titular;
    }
  } else {
    throw falla('tipo');
  }
  out.primera = validarFecha(x.primera);
  out.ultima = validarFecha(x.ultima);
  if (out.primera > out.ultima) throw falla('fecha');
  if (!Number.isInteger(x.veces) || x.veces < 1 || x.veces > MAX_VECES) throw falla('veces');
  out.veces = x.veces;
  return out;
}

/** Orden fijo: la misma bitácora da siempre la misma ficha. */
const ordenar = (ids) => ids.sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'telefono' ? -1 : 1)
  || (a.valor < b.valor ? -1 : a.valor > b.valor ? 1 : 0));

/**
 * Valida una ficha (de otra persona o guardada) y devuelve una copia limpia,
 * solo con los campos conocidos. Con "ahora", rechaza fechas futuras.
 */
function normalizar(f, ahora) {
  if (!esObjeto(f)) throw falla('noEs');
  if (f.formato !== FICHA_FORMATO) {
    if (typeof f.formato === 'string' && /^escudo-ficha\/\d{1,4}$/.test(f.formato)) throw falla('nueva');
    throw falla('noEs');
  }
  for (const k of Object.keys(f)) if (!['formato', 'generadaEn', 'identificadores'].includes(k)) throw falla('extra');
  const generadaEn = validarFecha(f.generadaEn);
  const limite = ahora ? fechaLima(new Date(ahora).getTime() + 2 * DIA) : '';
  if (limite && generadaEn > limite) throw falla('futuro');
  if (!Array.isArray(f.identificadores)) throw falla('danada');
  if (!f.identificadores.length) throw falla('vacia');
  if (f.identificadores.length > FICHA_MAX_IDENTIFICADORES) throw falla('muchos');
  const vistos = new Set();
  const ids = f.identificadores.map((x) => {
    const id = validarIdentificador(x);
    if (id.ultima > generadaEn) throw falla('fecha');
    const k = id.tipo + ':' + id.valor;
    if (vistos.has(k)) throw falla('repetido');
    vistos.add(k);
    return id;
  });
  return { formato: FICHA_FORMATO, generadaEn, identificadores: ordenar(ids) };
}

// ---------- Armar la ficha propia ----------

/**
 * Ficha de la bitácora: el número que contactó en cada incidente (E.164) y la
 * cuenta anotada para el pago (sus dígitos, como claveCuenta), con el medio,
 * el titular que muestra la app, la primera y la última fecha (solo el día) y
 * en cuántos incidentes aparece. Usa los datos ya corregidos por las notas y
 * deja fuera el propio celular de la víctima (datos.celular).
 * Devuelve { formato, generadaEn, identificadores }: sin nada de la víctima.
 */
export function buildFicha(log, datos = {}, ahora = new Date()) {
  const incidentes = applyCorrections(Array.isArray(log) ? log : []).filter((e) => e && e.tipo === 'incidente');
  const propio = classifyPhone(String(datos?.celular ?? '').slice(0, 30));
  const propioE164 = propio ? propio.e164 : '';
  const propioClave = propioE164.replace(/\D/g, '');
  const filas = new Map();
  const agregar = (tipo, valor, e, dia) => {
    const k = tipo + ':' + valor;
    let fila = filas.get(k);
    if (!fila) {
      fila = { tipo, valor, primera: dia, ultima: dia, incidentes: new Set(), medio: '', titular: '' };
      filas.set(k, fila);
    }
    // "veces" cuenta incidentes, no menciones.
    fila.incidentes.add(e);
    if (dia < fila.primera) fila.primera = dia;
    if (dia > fila.ultima) fila.ultima = dia;
    return fila;
  };

  for (const e of incidentes) {
    const dia = fechaLima(e.ocurridoEn);
    if (!dia) continue;
    const tel = classifyPhone(e.contacto);
    if (tel && RE_TELEFONO.test(tel.e164) && tel.e164 !== propioE164) agregar('telefono', tel.e164, e, dia);

    if (e.cuentaPago) {
      const clave = claveCuenta(e.cuentaPago);
      // Lo que no es una cuenta reconocible (un alias, un nombre) no viaja.
      if ((RE_CUENTA.test(clave) || RE_BILLETERA.test(clave)) && clave !== propioClave) {
        const fila = agregar('cuenta', clave, e, dia);
        const medio = e.medioPago ? (MEDIOS.includes(e.medioPago) ? e.medioPago : 'otro') : '';
        fila.medio = medioMasEspecifico(fila.medio, medio);
        if (!fila.titular) fila.titular = limpiarTitular(e.titularCuenta);
      }
    }
  }

  let lista = [...filas.values()];
  if (lista.length > FICHA_MAX_IDENTIFICADORES) {
    // Se quedan los que más se repiten y los más recientes.
    lista = lista.sort((a, b) => b.incidentes.size - a.incidentes.size || (a.ultima < b.ultima ? 1 : a.ultima > b.ultima ? -1 : 0))
      .slice(0, FICHA_MAX_IDENTIFICADORES);
  }
  const identificadores = ordenar(lista.map((f) => ({
    tipo: f.tipo,
    valor: f.valor,
    ...(f.tipo === 'cuenta' && f.medio ? { medio: f.medio } : {}),
    ...(f.tipo === 'cuenta' && f.titular ? { titular: f.titular } : {}),
    primera: f.primera,
    ultima: f.ultima,
    veces: Math.min(f.incidentes.size, MAX_VECES),
  })));
  const hoy = fechaLima(ahora) || '2000-01-01';
  const ultima = identificadores.reduce((m, x) => (x.ultima > m ? x.ultima : m), hoy);
  return { formato: FICHA_FORMATO, generadaEn: ultima, identificadores };
}

// ---------- Texto compacto para el QR ----------
//
// "EF1:" + base64url de un binario corto (así entran unas 20 cuentas y
// números en un QR que se lee bien de pantalla a cámara):
//   1 byte versión (1) · 2 bytes día de generación · 1 byte cantidad
//   por dato: 1 byte de banderas (bit 0 cuenta, bits 1-3 medio, bit 4 titular,
//   bit 5 billetera alfanumérica) · largo + dígitos en BCD (o ASCII) ·
//   2 bytes primer día · días hasta el último (varint) · veces (varint) ·
//   titular en UTF-8 con su largo.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function aBase64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += B64[(n >>> (18 - 6 * j)) & 63];
  }
  return out;
}

function deBase64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw falla('danada');
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let k = 0;
  for (const ch of text) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[k++] = (acc >>> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  if (acc !== 0) throw falla('danada');
  return out;
}

function aBinario(f) {
  const out = [];
  const u16 = (n) => out.push(n >>> 8, n & 255);
  const varint = (n) => {
    while (n >= 0x80) {
      out.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(n);
  };
  out.push(1);
  u16(diaDe(f.generadaEn));
  out.push(f.identificadores.length);
  for (const id of f.identificadores) {
    const cuenta = id.tipo === 'cuenta';
    const digitos = cuenta ? id.valor : id.valor.slice(1);
    const alfa = !/^\d+$/.test(digitos);
    const titular = cuenta && id.titular ? utf8(id.titular) : null;
    const medio = cuenta && id.medio ? MEDIOS.indexOf(id.medio) + 1 : 0;
    out.push((cuenta ? 1 : 0) | (medio << 1) | (titular ? 16 : 0) | (alfa ? 32 : 0));
    out.push(digitos.length);
    if (alfa) {
      for (const ch of digitos) out.push(ch.charCodeAt(0));
    } else {
      for (let i = 0; i < digitos.length; i += 2) {
        out.push((Number(digitos[i]) << 4) | (i + 1 < digitos.length ? Number(digitos[i + 1]) : 15));
      }
    }
    u16(diaDe(id.primera));
    varint(diaDe(id.ultima) - diaDe(id.primera));
    varint(id.veces);
    if (titular) {
      out.push(titular.length);
      out.push(...titular);
    }
  }
  return Uint8Array.from(out);
}

function deBinario(bytes) {
  let i = 0;
  const byte = () => {
    if (i >= bytes.length) throw falla('danada');
    return bytes[i++];
  };
  const u16 = () => (byte() << 8) | byte();
  const varint = () => {
    let n = 0;
    for (let s = 0; s < 21; s += 7) {
      const b = byte();
      n |= (b & 0x7f) << s;
      if (!(b & 0x80)) return n;
    }
    throw falla('danada');
  };
  const version = byte();
  if (version > 1) throw falla('nueva');
  if (version !== 1) throw falla('danada');
  const generadaEn = fechaDe(u16());
  const total = byte();
  if (total > FICHA_MAX_IDENTIFICADORES) throw falla('muchos');
  const identificadores = [];
  for (let n = 0; n < total; n++) {
    const flags = byte();
    const cuenta = (flags & 1) === 1;
    const medio = (flags >>> 1) & 7;
    const conTitular = (flags & 16) !== 0;
    const alfa = (flags & 32) !== 0;
    if (flags & 0xc0 || medio > MEDIOS.length || (!cuenta && (medio || conTitular || alfa))) throw falla('danada');
    const largo = byte();
    if (!largo || largo > 100) throw falla('danada');
    let valor = '';
    if (alfa) {
      for (let k = 0; k < largo; k++) valor += String.fromCharCode(byte());
    } else {
      for (let k = 0; k < largo; k += 2) {
        const b = byte();
        const alto = b >>> 4;
        const bajo = b & 15;
        if (alto > 9 || (k + 1 < largo ? bajo > 9 : bajo !== 15)) throw falla('danada');
        valor += alto + (k + 1 < largo ? String(bajo) : '');
      }
    }
    const primera = u16();
    const ultima = primera + varint();
    if (ultima > 65535) throw falla('fecha');
    const id = { tipo: cuenta ? 'cuenta' : 'telefono', valor: cuenta ? valor : '+' + valor };
    if (medio) id.medio = MEDIOS[medio - 1];
    id.primera = fechaDe(primera);
    id.ultima = fechaDe(ultima);
    id.veces = varint();
    if (conTitular) {
      const n2 = byte();
      const t = bytes.subarray(i, i + n2);
      if (t.length !== n2) throw falla('danada');
      i += n2;
      try {
        id.titular = new TextDecoder('utf-8', { fatal: true }).decode(t);
      } catch {
        throw falla('titular');
      }
    }
    identificadores.push(id);
  }
  if (i !== bytes.length) throw falla('danada');
  return { formato: FICHA_FORMATO, generadaEn, identificadores };
}

/** Texto compacto de la ficha para un código QR ("EF1:…"). */
export function serializeFicha(ficha) {
  return PREFIJO_QR + aBase64url(aBinario(normalizar(ficha, null)));
}

/** Contenido del archivo .escudo-ficha: JSON legible, para que se vea qué se comparte. */
export function fichaToJson(ficha) {
  return JSON.stringify(normalizar(ficha, null), null, 2) + '\n';
}

/**
 * Texto para el QR, o un error en español si no entra en un QR que se pueda
 * leer bien de pantalla a cámara (versión 25 por defecto): entonces la app
 * ofrece compartir el archivo. El error lleva code = 'FICHA_GRANDE'.
 */
export function fichaToQrText(ficha, { ecc = 'M', maxVersion = 25 } = {}) {
  const texto = serializeFicha(ficha);
  if (!qrVersionFor(texto, { ecc, maxVersion })) {
    const err = new Error('La ficha tiene demasiados números y cuentas para un código QR. Compártela como archivo.');
    err.code = 'FICHA_GRANDE';
    throw err;
  }
  return texto;
}

/**
 * Lee una ficha recibida: el texto del QR ("EF1:…") o el contenido del archivo
 * (JSON). La valida entera y devuelve una copia limpia; si algo no cuadra,
 * lanza un Error con un mensaje en español.
 */
export function parseFicha(text, ahora = new Date()) {
  if (typeof text !== 'string') throw falla('noEs');
  if (text.length > FICHA_MAX_CARACTERES) throw falla('grande');
  const t = text.replace(/^﻿/, '').trim();
  if (t.startsWith(PREFIJO_QR)) return normalizar(deBinario(deBase64url(t.slice(PREFIJO_QR.length))), ahora);
  if (/^EF\d{1,3}:/.test(t)) throw falla('nueva');
  if (t.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(t);
    } catch {
      throw falla('danada');
    }
    return normalizar(data, ahora);
  }
  throw falla('noEs');
}

// ---------- Coincidencias ----------

/** Contenido de la ficha sin la fecha de generación: la misma ficha guardada dos veces cuenta una vez. */
export function fichaClave(ficha) {
  return JSON.stringify(ficha.identificadores.map((x) => [x.tipo, x.valor, x.medio || '', x.titular || '', x.primera, x.ultima, x.veces]));
}

// El mismo número sirve de línea y de Yape: +51987654321 y la cuenta 51987654321 coinciden.
const claveCruce = (id) => (id.tipo === 'telefono' ? id.valor.slice(1) : id.valor);

/**
 * Cruza la ficha propia con las fichas que dieron otras personas.
 * Devuelve:
 *  - coincidencias: por cada número o cuenta propio que aparece en otras
 *    fichas, { valor, tipo, medio?, personas (fichas distintas que lo traen),
 *    veces (en esas fichas), fechas: { primera, ultima } (en esas fichas) };
 *  - summary: { personas, identificadores: [{ valor, tipo }] }, listo para
 *    pasarlo como datos.conexos a buildComplaintText;
 *  - fichas: cuántas fichas distintas se cruzaron; descartadas: cuántas no
 *    eran válidas.
 * Las fichas repetidas (mismo contenido) y la propia cuentan una sola vez o
 * ninguna: es mejor decir de menos que de más en una denuncia.
 */
export function matchFichas(log, fichas = [], datos = {}) {
  const propia = buildFicha(log, datos);
  const clavePropia = propia.identificadores.length ? fichaClave(propia) : null;
  const otras = [];
  const vistas = new Set();
  let descartadas = 0;
  for (const f of Array.isArray(fichas) ? fichas : []) {
    let n;
    try {
      n = normalizar(f, null);
    } catch {
      descartadas++;
      continue;
    }
    const k = fichaClave(n);
    if (k === clavePropia || vistas.has(k)) continue;
    vistas.add(k);
    otras.push(n);
  }

  const indice = new Map();
  otras.forEach((f, n) => {
    for (const id of f.identificadores) {
      const k = claveCruce(id);
      if (!indice.has(k)) indice.set(k, []);
      indice.get(k).push({ n, id });
    }
  });

  const personas = new Set();
  const coincidencias = [];
  for (const id of propia.identificadores) {
    const hits = indice.get(claveCruce(id));
    if (!hits) continue;
    // Si una ficha trae el mismo número como línea y como Yape, cuenta una vez (el mayor).
    const porFicha = new Map();
    for (const h of hits) porFicha.set(h.n, Math.max(porFicha.get(h.n) || 0, h.id.veces));
    for (const n of porFicha.keys()) personas.add(n);
    coincidencias.push({
      valor: id.valor,
      tipo: id.tipo,
      ...(id.medio ? { medio: id.medio } : {}),
      personas: porFicha.size,
      veces: [...porFicha.values()].reduce((a, b) => a + b, 0),
      fechas: {
        primera: hits.reduce((m, h) => (h.id.primera < m ? h.id.primera : m), hits[0].id.primera),
        ultima: hits.reduce((m, h) => (h.id.ultima > m ? h.id.ultima : m), hits[0].id.ultima),
      },
    });
  }
  coincidencias.sort((a, b) => b.personas - a.personas || (a.tipo === b.tipo ? 0 : a.tipo === 'telefono' ? -1 : 1)
    || (a.valor < b.valor ? -1 : 1));
  return {
    coincidencias,
    summary: { personas: personas.size, identificadores: coincidencias.map((c) => ({ valor: c.valor, tipo: c.tipo })) },
    fichas: otras.length,
    descartadas,
  };
}

/** Coincidencias del número que contactó y de la cuenta de pago de un incidente (ya corregido). */
export function matchesForIncident(match, entry) {
  if (!match || !Array.isArray(match.coincidencias) || !entry || entry.tipo !== 'incidente') return [];
  const out = [];
  const tel = classifyPhone(entry.contacto);
  if (tel) out.push(match.coincidencias.find((c) => c.tipo === 'telefono' && c.valor === tel.e164));
  if (entry.cuentaPago) {
    const clave = claveCuenta(entry.cuentaPago);
    out.push(match.coincidencias.find((c) => c.tipo === 'cuenta' && c.valor === clave));
  }
  return out.filter(Boolean);
}

/** "Este número también aparece en las fichas de 2 personas (del 01/09/2026 al 12/10/2026)." */
export function describeMatch(c) {
  const que = c.tipo === 'cuenta' ? 'Esta cuenta' : 'Este número';
  const quienes = c.personas === 1 ? 'la ficha de otra persona' : `las fichas de ${c.personas} personas`;
  const cuando = c.fechas.primera === c.fechas.ultima
    ? `el ${fechaCorta(c.fechas.primera)}`
    : `del ${fechaCorta(c.fechas.primera)} al ${fechaCorta(c.fechas.ultima)}`;
  return `${que} también aparece en ${quienes} (${cuando}).`;
}
