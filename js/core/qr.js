// Código QR sin dependencias ni red (ISO/IEC 18004): modo byte, versiones 1 a
// 40 y niveles de corrección L, M, Q y H. Sirve para mostrar en pantalla la
// ficha conjunta y que otra víctima la lea con la cámara, sin internet.
//
// Se sigue el algoritmo de la norma: datos → bloques con Reed–Solomon →
// intercalado → ubicación en zigzag → las 8 máscaras con su puntaje de
// penalidad → información de formato y de versión con su código BCH.

// Corrección de errores: orden en las tablas y bits del formato (L=01, M=00, Q=11, H=10).
const NIVELES = {
  L: { ord: 0, bits: 1 },
  M: { ord: 1, bits: 0 },
  Q: { ord: 2, bits: 3 },
  H: { ord: 3, bits: 2 },
};

// Códigos de corrección por bloque y número de bloques, por nivel y versión
// (índice 0 sin uso). Tabla 9 de la norma.
const EC_POR_BLOQUE = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const BLOQUES = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function nivel(ecc) {
  const n = NIVELES[String(ecc ?? 'M').toUpperCase()];
  if (!n) throw new Error('Nivel de corrección de errores no válido (usa L, M, Q o H).');
  return n;
}

function versionValida(v) {
  if (!Number.isInteger(v) || v < 1 || v > 40) throw new Error('Versión de código QR no válida (de 1 a 40).');
  return v;
}

/** Módulos disponibles para datos y corrección (sin patrones fijos ni formato). */
function modulosDeDatos(version) {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alineacion = Math.floor(version / 7) + 2;
    n -= (25 * alineacion - 10) * alineacion - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

/** Bytes de datos (sin corrección) que lleva una versión con un nivel. */
function codigosDeDatos(version, ord) {
  return Math.floor(modulosDeDatos(version) / 8) - EC_POR_BLOQUE[ord][version] * BLOQUES[ord][version];
}

/** Bits del contador de caracteres en modo byte. */
const bitsContador = (version) => (version <= 9 ? 8 : 16);

/** Bytes de texto (UTF-8) que caben en modo byte con esa versión y nivel. */
export function qrCapacity(version, ecc = 'M') {
  const { ord } = nivel(ecc);
  versionValida(version);
  return Math.floor((codigosDeDatos(version, ord) * 8 - 4 - bitsContador(version)) / 8);
}

const utf8 = (text) => new TextEncoder().encode(String(text ?? ''));

/**
 * Versión más chica en la que cabe el texto, o 0 si no cabe hasta maxVersion.
 * Sirve para avisar antes de dibujar que el contenido es demasiado grande.
 */
export function qrVersionFor(text, { ecc = 'M', minVersion = 1, maxVersion = 40 } = {}) {
  const largo = typeof text === 'number' ? text : utf8(text).length;
  versionValida(minVersion);
  versionValida(maxVersion);
  for (let v = minVersion; v <= maxVersion; v++) if (largo <= qrCapacity(v, ecc)) return v;
  return 0;
}

// ---------- Reed–Solomon en GF(256) con el polinomio 0x11D ----------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Polinomio generador de grado n (sin el término principal), de mayor a menor grado. */
function generador(n) {
  const g = new Uint8Array(n);
  g[n - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g[j] = mul(g[j], raiz);
      if (j + 1 < n) g[j] ^= g[j + 1];
    }
    raiz = mul(raiz, 2);
  }
  return g;
}

/** Resto de dividir los datos por el generador: los códigos de corrección. */
function resto(datos, g) {
  const r = new Uint8Array(g.length);
  for (const b of datos) {
    const factor = b ^ r[0];
    r.copyWithin(0, 1);
    r[r.length - 1] = 0;
    for (let i = 0; i < g.length; i++) r[i] ^= mul(g[i], factor);
  }
  return r;
}

// ---------- Datos ----------

/** Modo byte, contador, datos, terminador y bytes de relleno 0xEC 0x11. */
function codificarDatos(bytes, version, ord) {
  const capacidad = codigosDeDatos(version, ord) * 8;
  const bits = [];
  const poner = (valor, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  poner(0b0100, 4);
  poner(bytes.length, bitsContador(version));
  for (const b of bytes) poner(b, 8);
  poner(0, Math.min(4, capacidad - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacidad; pad ^= 0xec ^ 0x11) poner(pad, 8);
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bits.length; i++) out[i >>> 3] |= bits[i] << (7 - (i & 7));
  return out;
}

/** Divide en bloques, agrega Reed–Solomon a cada uno e intercala. */
function intercalar(datos, version, ord) {
  const nBloques = BLOQUES[ord][version];
  const ecLargo = EC_POR_BLOQUE[ord][version];
  const total = Math.floor(modulosDeDatos(version) / 8);
  const cortos = nBloques - (total % nBloques);
  const largoCorto = Math.floor(total / nBloques);
  const g = generador(ecLargo);
  const bloques = [];
  for (let i = 0, k = 0; i < nBloques; i++) {
    const n = largoCorto - ecLargo + (i < cortos ? 0 : 1);
    const dat = datos.subarray(k, k + n);
    k += n;
    bloques.push({ dat, ec: resto(dat, g) });
  }
  const out = [];
  for (let i = 0; i <= largoCorto - ecLargo; i++) {
    for (const b of bloques) if (i < b.dat.length) out.push(b.dat[i]);
  }
  for (let i = 0; i < ecLargo; i++) for (const b of bloques) out.push(b.ec[i]);
  if (out.length !== total) throw new Error('Error interno del código QR.');
  return out;
}

// ---------- Matriz ----------

/** Centros de los patrones de alineación de una versión. */
export function alignmentPositions(version) {
  versionValida(version);
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const paso = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const pos = [6];
  for (let p = version * 4 + 10; pos.length < n; p -= paso) pos.splice(1, 0, p);
  return pos;
}

const MASCARAS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 15 bits de formato: nivel y máscara con BCH(15,5) y la máscara 0x5412. */
export function formatBits(ecc, mask) {
  const datos = (nivel(ecc).bits << 3) | mask;
  let r = datos;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((datos << 10) | r) ^ 0x5412;
}

/** 18 bits de versión (desde la 7) con BCH(18,6). */
export function versionBits(version) {
  let r = version;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  return (version << 12) | r;
}

class Matriz {
  constructor(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.mod = new Uint8Array(this.size * this.size);
    this.fijo = new Uint8Array(this.size * this.size);
  }

  fijar(x, y, oscuro) {
    const i = y * this.size + x;
    this.mod[i] = oscuro ? 1 : 0;
    this.fijo[i] = 1;
  }

  patronesFijos() {
    const { size } = this;
    for (let i = 0; i < size; i++) {
      this.fijar(6, i, i % 2 === 0);
      this.fijar(i, 6, i % 2 === 0);
    }
    // Patrones de posición con su separador claro.
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) this.fijar(x, y, d !== 2 && d !== 4);
        }
      }
    }
    const pos = alignmentPositions(this.version);
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // No se dibujan encima de los patrones de posición.
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) this.fijar(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    this.formato(0);
    if (this.version >= 7) {
      const bits = versionBits(this.version);
      for (let i = 0; i < 18; i++) {
        const oscuro = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.fijar(a, b, oscuro);
        this.fijar(b, a, oscuro);
      }
    }
  }

  /** Dibuja (o reserva, con bits = 0) las dos copias del formato y el módulo oscuro. */
  formato(bits) {
    const { size } = this;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.fijar(8, i, bit(i));
    this.fijar(8, 7, bit(6));
    this.fijar(8, 8, bit(7));
    this.fijar(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.fijar(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.fijar(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.fijar(8, size - 15 + i, bit(i));
    this.fijar(8, size - 8, true);
  }

  /** Ubica los bytes en zigzag, de dos columnas en dos, desde la esquina inferior derecha. */
  datos(codigos) {
    const { size } = this;
    const totalBits = codigos.length * 8;
    let i = 0;
    for (let der = size - 1; der >= 1; der -= 2) {
      if (der === 6) der = 5;
      const subiendo = ((der + 1) & 2) === 0;
      for (let v = 0; v < size; v++) {
        const y = subiendo ? size - 1 - v : v;
        for (let j = 0; j < 2; j++) {
          const x = der - j;
          const k = y * size + x;
          if (this.fijo[k]) continue;
          // Los bits que sobran (resto) quedan claros y luego se enmascaran.
          this.mod[k] = i < totalBits ? (codigos[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
          i++;
        }
      }
    }
  }

  /** Invierte los módulos de datos según la máscara (aplicarla dos veces la quita). */
  mascara(m) {
    const f = MASCARAS[m];
    const { size } = this;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = y * size + x;
        if (!this.fijo[k] && f(x, y)) this.mod[k] ^= 1;
      }
    }
  }

  /** Penalidad de la norma (reglas N1 a N4): la máscara con menos puntaje se lee mejor. */
  penalidad() {
    const { size, mod } = this;
    let p = 0;
    const linea = (get) => {
      // N1: tramos de 5 o más módulos iguales.
      let largo = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && get(i) === get(i - 1)) largo++;
        else {
          if (largo >= 5) p += 3 + (largo - 5);
          largo = 1;
        }
      }
      // N3: patrón 1:1:3:1:1 con 4 módulos claros a un lado (fuera del símbolo cuenta como claro).
      const v = (i) => (i < 0 || i >= size ? 0 : get(i));
      for (let i = 0; i + 6 < size; i++) {
        if (v(i) && !v(i + 1) && v(i + 2) && v(i + 3) && v(i + 4) && !v(i + 5) && v(i + 6)) {
          const antes = !v(i - 1) && !v(i - 2) && !v(i - 3) && !v(i - 4);
          const despues = !v(i + 7) && !v(i + 8) && !v(i + 9) && !v(i + 10);
          if (antes || despues) p += 40;
        }
      }
    };
    for (let y = 0; y < size; y++) linea((x) => mod[y * size + x]);
    for (let x = 0; x < size; x++) linea((y) => mod[y * size + x]);
    // N2: bloques de 2×2 del mismo color.
    for (let y = 0; y + 1 < size; y++) {
      for (let x = 0; x + 1 < size; x++) {
        const c = mod[y * size + x];
        if (c === mod[y * size + x + 1] && c === mod[(y + 1) * size + x] && c === mod[(y + 1) * size + x + 1]) p += 3;
      }
    }
    // N4: proporción de módulos oscuros lejos del 50 %.
    let oscuros = 0;
    for (const c of mod) oscuros += c;
    const total = size * size;
    p += Math.floor(Math.abs(oscuros * 20 - total * 10) / total) * 10;
    return p;
  }
}

/**
 * Matriz del código QR del texto (UTF-8, modo byte), en la versión más chica
 * que alcance. Devuelve { size, version, ecc, mask, get(x, y) }: get es true
 * para un módulo oscuro; fuera del símbolo (zona en blanco) es false.
 * Opciones: ecc ('M' por defecto, o 'L', 'Q', 'H'), minVersion, maxVersion y
 * mask (0 a 7) para forzar una máscara; sin mask se elige la de menor penalidad.
 */
export function qrMatrix(text, { ecc = 'M', minVersion = 1, maxVersion = 40, mask } = {}) {
  const { ord } = nivel(ecc);
  const bytes = utf8(text);
  const version = qrVersionFor(bytes.length, { ecc, minVersion, maxVersion });
  if (!version) throw new Error('El contenido es demasiado largo para un código QR.');
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    throw new Error('Máscara no válida (de 0 a 7).');
  }
  const m = new Matriz(version);
  m.patronesFijos();
  m.datos(intercalar(codificarDatos(bytes, version, ord), version, ord));
  const letra = String(ecc).toUpperCase();
  let elegida = mask;
  if (elegida === undefined) {
    let menor = Infinity;
    for (let k = 0; k < 8; k++) {
      m.mascara(k);
      m.formato(formatBits(letra, k));
      const p = m.penalidad();
      if (p < menor) {
        menor = p;
        elegida = k;
      }
      m.mascara(k);
    }
  }
  m.mascara(elegida);
  m.formato(formatBits(letra, elegida));
  const { size, mod } = m;
  return Object.freeze({
    size,
    version,
    ecc: letra,
    mask: elegida,
    get(x, y) {
      return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size && mod[y * size + x] === 1;
    },
  });
}

const escaparAtributo = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * SVG del código QR: solo atributos (sin <style>, sin style="" ni scripts), así
 * lo acepta la política de seguridad de la app. Negro sobre blanco, con zona
 * en blanco alrededor (margin, en módulos; la norma pide 4).
 * Opciones: scale (píxeles por módulo), margin, titulo (texto para lectores de
 * pantalla) y las de qrMatrix. También acepta una matriz ya calculada.
 */
export function qrSvg(text, { scale = 4, margin = 4, titulo = 'Código QR', ...opciones } = {}) {
  if (!Number.isInteger(scale) || scale < 1 || scale > 64) throw new Error('Escala no válida.');
  if (!Number.isInteger(margin) || margin < 0 || margin > 16) throw new Error('Margen no válido.');
  const qr = text && typeof text === 'object' && typeof text.get === 'function' ? text : qrMatrix(text, opciones);
  const n = qr.size + margin * 2;
  // Un rectángulo por tramo horizontal de módulos oscuros.
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.get(x, y)) continue;
      let largo = 1;
      while (qr.get(x + largo, y)) largo++;
      d += `M${x + margin} ${y + margin}h${largo}v1h-${largo}z`;
      x += largo;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n * scale}" height="${n * scale}" viewBox="0 0 ${n} ${n}"`
    + ` shape-rendering="crispEdges" role="img" aria-label="${escaparAtributo(titulo)}">`
    + `<rect width="${n}" height="${n}" fill="#ffffff"/><path fill="#000000" d="${d}"/></svg>`;
}
