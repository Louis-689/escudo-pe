// Criptografía de Escudo. Solo usa Web Crypto (navegador y Node >= 20),
// sin dependencias externas.
//
// - La clave se deriva de la contraseña con PBKDF2-SHA256.
// - Los datos se cifran con AES-GCM (256 bits), que además detecta alteraciones.
// - Las huellas de las pruebas se calculan con SHA-256.

const subtle = globalThis.crypto && globalThis.crypto.subtle;

export const KDF_ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export function isCryptoAvailable() {
  return Boolean(subtle);
}

function requireSubtle() {
  if (!subtle) {
    throw new Error(
      'Tu navegador no permite cifrar en esta página. Ábrela desde https:// o actualiza el navegador.'
    );
  }
  return subtle;
}

export function randomBytes(length) {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function utf8(text) {
  return new TextEncoder().encode(text);
}

export function fromUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

export function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Huella SHA-256 en hexadecimal de un texto o de bytes. */
export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  const digest = await requireSubtle().digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

export function newSalt() {
  return toBase64(randomBytes(SALT_BYTES));
}

/** Deriva una clave AES-GCM a partir de la contraseña y la sal (base64). */
export async function deriveKey(password, saltB64, iterations = KDF_ITERATIONS) {
  const s = requireSubtle();
  const base = await s.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Cifra bytes. Devuelve { iv, ct } en base64. */
export async function encryptBytes(key, bytes) {
  const iv = randomBytes(IV_BYTES);
  const ct = await requireSubtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

/** Descifra { iv, ct }. Lanza un error si la clave es incorrecta o el dato fue alterado. */
export async function decryptBytes(key, box) {
  try {
    const pt = await requireSubtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(box.iv) },
      key,
      fromBase64(box.ct)
    );
    return new Uint8Array(pt);
  } catch {
    throw new Error('No se pudo descifrar: contraseña incorrecta o datos dañados.');
  }
}

export async function encryptJson(key, value) {
  return encryptBytes(key, utf8(JSON.stringify(value)));
}

export async function decryptJson(key, box) {
  return JSON.parse(fromUtf8(await decryptBytes(key, box)));
}
