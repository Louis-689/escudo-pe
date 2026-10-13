// Interfaz de Escudo. Toda la lógica sensible vive en js/core/ y tiene tests.

import { Vault, MAX_FILE_BYTES } from './core/vault.js';
import { IndexedDBStorage } from './core/storage.js';
import { isCryptoAvailable, sha256Hex } from './core/crypto.js';
import { buildEvidencePackage, findByHash } from './core/evidence.js';
import { extractIndicators, classifyPhone } from './core/indicators.js';
import { parseWhatsAppChat, chatToIncidents } from './core/whatsapp.js';
import { readZip } from './core/unzip.js';
import { CANALES, MEDIOS_PAGO, formatSoles } from './core/model.js';
import { buildTextReport, buildHtmlReport, buildReportBody, formatDate } from './core/report.js';
import { CONTACTOS, PASOS, VERIFICADO } from './data/contacts.js';
import {
  normalizeContact, nextLimaTime, hhmm, sosMessage, tripMessage, arrivalMessage, whatsappLink, smsLink, PLAN, BLINDAJE,
} from './core/safety.js';

const storage = new IndexedDBStorage();
const AUTO_LOCK_MS = 2 * 60 * 1000;
const IDLE_LOCK_MS = 5 * 60 * 1000;
const EXIT_URL = 'https://www.google.com/search?q=clima+lima';

const CAMO_KEY = 'escudo.camuflaje';
const DECOY_KEY = 'escudo.nota';

let vault = null;
let hiddenAt = 0;
let lastActivity = Date.now();
let chatImport = null;
let previousView = 'setup';
let pendingFiles = [];
let recorder = null;
const objectUrls = new Set();
const FAILS_KEY = 'escudo.intentos';
// Contactos de confianza y trayecto en curso: sin cifrar, para que el SOS
// funcione sin contraseña. Solo nombre y número; nunca el destino.
const SOS_KEY = 'escudo.sos';
const TRIP_KEY = 'escudo.trayecto';
let plan = null;
let sosReturn = 'unlock';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crea un elemento sin usar innerHTML, para no interpretar texto de terceros. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

function say(text, kind = '') {
  const box = $('#msg');
  box.textContent = text;
  box.className = 'box ' + kind;
  box.hidden = !text;
  if (text) box.scrollIntoView({ block: 'nearest' });
}

function busy(button, on, label = 'Un momento…') {
  if (!button) return;
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function show(view) {
  for (const v of $$('.view')) v.hidden = v.id !== 'view-' + view;
  window.scrollTo(0, 0);
}

function showTab(tab) {
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const t of $$('.tab')) t.hidden = t.id !== 'tab-' + tab;
  if (tab === 'log') renderLog();
  if (tab === 'protect') {
    renderTrusted();
    renderTrip();
    renderPlan().catch((err) => say(err.message, 'err'));
  }
  say('');
}

function localDateTimeValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fillSelect(select, options) {
  select.replaceChildren(...Object.entries(options).map(([v, label]) => el('option', { value: v }, label)));
}

function renderHelp(target) {
  const tpl = $('#tpl-help').content.cloneNode(true);
  $('.steps', tpl).append(...PASOS.map((p) => el('li', {}, el('b', {}, p.titulo), el('br'), p.texto)));
  $('.contacts', tpl).append(...CONTACTOS.map((c) => el('li', {},
    el('b', {}, c.nombre), el('br'), c.detalle, el('br'),
    el('a', { class: 'call', href: 'tel:' + c.numero }, 'Llamar al ' + c.numero.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')))));
  $('.verified', tpl).textContent = VERIFICADO;
  target.replaceChildren(tpl);
}

function resetForm() {
  const form = $('#form-new');
  form.reset();
  pendingFiles = [];
  renderPending();
  form.ocurridoEn.value = localDateTimeValue();
  form.ocurridoEn.max = localDateTimeValue(new Date(Date.now() + 60 * 1000));
}

async function addPending(fileList) {
  for (const f of fileList) {
    if (f.size > MAX_FILE_BYTES) {
      say(`"${f.name}" pesa más de 15 MB y no se puede guardar. Si es un video, recórtalo o envíalo comprimido.`, 'err');
      continue;
    }
    pendingFiles.push({ nombre: f.name, tipo: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  renderPending();
}

function renderPending() {
  $('#pending').replaceChildren(...pendingFiles.map((f, i) => el('li', {},
    el('span', {}, f.nombre, ' ', el('span', { class: 'hint' }, `(${Math.ceil(f.bytes.length / 1024)} KB)`)),
    el('button', { type: 'button', onclick: () => { pendingFiles.splice(i, 1); renderPending(); } }, 'Quitar'))));
}

// ---------- Importar chat de WhatsApp ----------

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  opus: 'audio/ogg', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', amr: 'audio/amr',
  mp4: 'video/mp4', '3gp': 'video/3gpp', mov: 'video/quicktime', pdf: 'application/pdf',
  vcf: 'text/vcard', txt: 'text/plain',
};

function mimeOf(name) {
  return MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
}

async function loadChat(fileList) {
  const files = [];
  for (const f of fileList) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) files.push(...(await readZip(bytes)));
    else files.push({ name: f.name, bytes });
  }
  const txts = files.filter((f) => /\.txt$/i.test(f.name));
  const chat = txts.find((f) => /chat/i.test(f.name)) || txts[0];
  if (!chat) throw new Error('No encontré el archivo .txt del chat. Elige el .zip exportado o el archivo .txt.');
  const parsed = parseWhatsAppChat(new TextDecoder().decode(chat.bytes));
  if (!parsed.mensajes.length) throw new Error('El archivo no parece un chat exportado de WhatsApp.');
  const media = new Map(files.filter((f) => f !== chat).map((f) => [f.name, f.bytes]));
  return { chat, parsed, media };
}

function renderChatImport() {
  const { chat, parsed, media } = chatImport;
  const first = parsed.mensajes[0].fecha;
  const last = parsed.mensajes[parsed.mensajes.length - 1].fecha;
  $('#wa-summary').textContent = `"${chat.name}": ${parsed.mensajes.length} mensajes del ${formatDate(first)} al ${formatDate(last)}, ${media.size} archivo(s).`;
  $('#wa-authors div').replaceChildren(...parsed.participantes.map((p) => el('label', { class: 'inline' },
    el('input', { type: 'checkbox', value: p.autor, ...(classifyPhone(p.autor) ? { checked: '' } : {}) }),
    `${p.autor} (${p.total} mensajes)`)));
  $('#wa-step2').hidden = false;
}

async function importChat(btn) {
  if (!chatImport) return;
  const autores = $$('#wa-authors input:checked').map((i) => i.value);
  if (!autores.length) return say('Marca al menos a una persona.', 'err');
  busy(btn, true, 'Importando…');
  try {
    const { chat, parsed, media } = chatImport;
    const skipped = [];
    const toFile = (name) => {
      const bytes = media.get(name);
      if (!bytes) return null;
      if (bytes.length > MAX_FILE_BYTES) { skipped.push(name); return null; }
      return { nombre: name, tipo: mimeOf(name), bytes };
    };
    const items = chatToIncidents(parsed, autores, { archivo: `chat "${chat.name}"` }).map(({ adjuntoNombres, ...input }) => {
      const files = adjuntoNombres.map(toFile).filter(Boolean);
      const missing = adjuntoNombres.filter((n) => !media.has(n));
      if (missing.length) input.descripcion += ` Archivos mencionados que no se eligieron: ${missing.join(', ')}.`;
      return { input, files };
    });
    if (!items.length) throw new Error('Esas personas no tienen mensajes en el chat.');
    const last = parsed.mensajes[parsed.mensajes.length - 1].fecha;
    items.unshift({
      input: {
        ocurridoEn: last, canal: 'whatsapp', contacto: autores[0],
        descripcion: `Exportación completa del chat de WhatsApp "${chat.name}" (${parsed.mensajes.length} mensajes, del ${formatDate(parsed.mensajes[0].fecha)} al ${formatDate(last)}). Se adjunta el archivo original.`,
      },
      files: chat.bytes.length <= MAX_FILE_BYTES ? [{ nombre: chat.name, tipo: 'text/plain', bytes: chat.bytes }] : [],
    });
    try {
      await vault.addMany(items);
    } catch (err) {
      throw new Error(`No se pudo importar: ${err.message} Revisa que la fecha y hora del celular sean correctas.`);
    }
    await custody('importacion', `${items.length - 1} registro(s) desde "${chat.name}"`);
    chatImport = null;
    $('#wa-files').value = '';
    $('#wa-step2').hidden = true;
    $('#wa-card').open = false;
    say(`Listo: ${items.length - 1} registro(s) importados${skipped.length ? `. No se guardaron por pesar más de 15 MB: ${skipped.join(', ')}` : ''}. Revísalos en Bitácora.`, skipped.length ? 'err' : 'ok');
  } finally {
    busy(btn, false);
  }
}

// ---------- Grabación de audio ----------

function canRecord() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

async function toggleRecording(btn) {
  if (recorder) {
    recorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    say('No se pudo usar el micrófono. Revisa los permisos del navegador.', 'err');
    return;
  }
  const chunks = [];
  const started = new Date();
  const rec = new MediaRecorder(stream);
  const timer = setInterval(() => {
    const secs = Math.floor((Date.now() - started) / 1000);
    $('#rec-status').textContent = `Grabando ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  }, 500);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    recorder = null;
    btn.classList.remove('recording');
    btn.textContent = '🎙️ Grabar audio';
    $('#rec-status').textContent = '';
    if (!vault || !chunks.length) return;
    const type = rec.mimeType || 'audio/webm';
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
    const blob = new Blob(chunks, { type });
    const name = `grabacion-${localDateTimeValue(started).replace('T', '-').replace(':', '')}.${ext}`;
    pendingFiles.push({ nombre: name, tipo: type.split(';')[0], bytes: new Uint8Array(await blob.arrayBuffer()) });
    renderPending();
    say('Grabación lista. Se guardará al pulsar "Guardar registro".', 'ok');
  };
  recorder = rec;
  rec.start(1000);
  btn.classList.add('recording');
  btn.textContent = '⏹️ Detener grabación';
}


// ---------- Protección: SOS, aviso de trayecto, plan y blindaje ----------

function getJson(key, fallback) {
  try { return JSON.parse(getPref(key)) ?? fallback; } catch { return fallback; }
}

const trustedContacts = () => {
  const list = getJson(SOS_KEY, []);
  return Array.isArray(list) ? list.filter((c) => c && typeof c.nombre === 'string' && typeof c.numero === 'string') : [];
};

function linkButtons(target, contacts, text) {
  const links = contacts.map((c) => el('a', {
    class: 'link-btn wa', href: whatsappLink(c.numero, text), target: '_blank', rel: 'noopener noreferrer',
  }, `WhatsApp a ${c.nombre}`));
  // Un SMS por contacto: los enlaces con varios destinatarios no funcionan igual en todos los celulares.
  for (const c of contacts) links.push(el('a', { class: 'link-btn', href: smsLink([c.numero], text) }, `SMS a ${c.nombre}`));
  target.replaceChildren(...links);
}

function renderTrusted() {
  const list = trustedContacts();
  $('#trusted').replaceChildren(...list.map((c, i) => el('li', {},
    el('span', {}, `${c.nombre} · ${c.numero}`),
    el('button', { type: 'button', onclick: () => {
      setPref(SOS_KEY, JSON.stringify(list.filter((_, j) => j !== i)));
      renderTrusted();
    } }, 'Quitar'))));
  if (!list.length) $('#trusted').append(el('li', {}, 'Aún no tienes contactos de confianza.'));
  const select = $('#form-trip').contacto;
  select.replaceChildren(...list.map((c, i) => el('option', { value: String(i) }, c.nombre)));
  if (!list.length) select.append(el('option', { value: '' }, 'Primero agrega un contacto en SOS'));
}

/** Ubicación de la propia persona, si lo permite. Nunca bloquea el SOS más de unos segundos. */
function myLocation(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeout + 1000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

function openSos() {
  if (!$('#view-sos').hidden) return;
  sosReturn = [...$$('.view')].find((v) => !v.hidden)?.id.replace('view-', '') || 'unlock';
  say('');
  $('#sos-status').textContent = '';
  $('#sos-links').replaceChildren();
  renderTrusted();
  $('#sos-config').open = !trustedContacts().length;
  show('sos');
}

async function sendSos(btn) {
  const contacts = trustedContacts();
  if (!contacts.length) {
    $('#sos-config').open = true;
    $('#sos-status').textContent = 'Agrega al menos un contacto de confianza abajo.';
    return;
  }
  busy(btn, true, 'Buscando tu ubicación…');
  const ubicacion = await myLocation();
  busy(btn, false);
  $('#sos-status').textContent = ubicacion
    ? 'Mensaje listo con tu ubicación. Toca un botón y pulsa "Enviar".'
    : 'No se pudo obtener tu ubicación (activa el GPS si puedes). El mensaje sale igual. Toca un botón y pulsa "Enviar".';
  linkButtons($('#sos-links'), contacts, sosMessage({ ubicacion }));
}

function activeTrip() {
  const t = getJson(TRIP_KEY, null);
  return t && typeof t.hasta === 'string' && typeof t.numero === 'string' ? t : null;
}

function renderTrip() {
  const t = activeTrip();
  $('#trip-active').hidden = !t;
  $('#form-trip').hidden = Boolean(t);
  if (!t) return;
  const hasta = new Date(t.hasta);
  const late = hasta < new Date();
  $('#trip-info').textContent = `${t.nombre} espera tu aviso antes de las ${hhmm(hasta)}.`
    + (late ? ' ⚠️ Ya pasó la hora: avísale ahora para que no se preocupe.' : '');
  const text = arrivalMessage();
  $('#trip-arrived').replaceChildren(
    el('a', { class: 'link-btn wa', href: whatsappLink(t.numero, text), target: '_blank', rel: 'noopener noreferrer', onclick: endTrip }, '✅ Llegué bien (WhatsApp)'),
    el('a', { class: 'link-btn', href: smsLink([t.numero], text), onclick: endTrip }, '✅ Llegué bien (SMS)'),
  );
}

function endTrip() {
  setPref(TRIP_KEY, null);
  setTimeout(() => {
    $('#trip-links').replaceChildren();
    renderTrip();
  }, 500);
}

async function renderPlan() {
  const owner = vault;
  const loaded = await owner.getPlan();
  // Si se bloqueó mientras se descifraba, no se muestra nada.
  if (vault !== owner) return;
  plan = loaded;
  $('#clave-familiar').value = plan.palabraClave || '';
  $('#plan').replaceChildren(...PLAN.map((sec) => el('div', { class: 'plan-section' },
    el('h3', {}, sec.titulo),
    ...sec.items.map(([id, texto]) => {
      const box = el('input', { type: 'checkbox', 'data-plan': id });
      box.checked = Boolean(plan.hechos[id]);
      return el('label', { class: 'inline' }, box, ' ', texto);
    }))));
  $('#plan').prepend(el('p', { id: 'plan-progress', class: 'hint' }));
  renderPlanProgress();
}

function renderPlanProgress() {
  const all = PLAN.flatMap((sec) => sec.items);
  $('#plan-progress').textContent = `Avance: ${all.filter(([id]) => plan.hechos[id]).length} de ${all.length}.`;
}

async function savePlan() {
  if (!vault || !plan) return;
  await vault.savePlan(plan);
}

function renderBlindaje() {
  $('#blindaje').replaceChildren(...BLINDAJE.map((sec) => el('details', {},
    el('summary', {}, el('b', {}, sec.titulo)),
    el('ol', {}, ...sec.pasos.map((p) => el('li', {}, p))))));
}

// ---------- Modo camuflado ----------

function getPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Devuelve false si el navegador no deja guardar (modo privado, datos bloqueados). */
function setPref(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

const isCamo = () => getPref(CAMO_KEY) === '1';

function applyLook(locked) {
  const camo = locked && isCamo();
  document.body.classList.toggle('camo', camo);
  document.title = camo ? 'Notas' : 'Escudo';
  $('#brand').textContent = camo ? 'Notas' : 'Escudo';
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

async function reportOptions() {
  return { verificacion: await vault.verify(), creadoEn: vault.meta.creadoEn };
}

/** Deja constancia en la cadena de custodia sin interrumpir a la persona si falla. */
async function custody(evento, detalle = '') {
  try {
    await vault.logCustody(evento, detalle);
  } catch { /* no bloquear la acción principal */ }
}

// ---------- Bitácora ----------

function renderDetected(e) {
  const f = extractIndicators([e.mensaje, e.descripcion].filter(Boolean).join('\n'));
  const contact = classifyPhone(e.contacto);
  const items = [
    contact && `Número ${contact.e164} (${contact.tipo}, ${contact.pais})`,
    ...f.telefonos.filter((t) => !contact || t.valor !== contact.e164).map((t) => `Número ${t.valor} (${t.tipo}, ${t.pais})`),
    ...f.cuentas.map((c) => `${c.tipo}: ${c.valor}`),
    ...f.billeteras.map((b) => `Billetera ${b.red}: ${b.valor}`),
    ...f.enlaces.map((x) => `Enlace: ${x.valor}`),
    ...f.perfiles.map((x) => `Perfil: ${x.valor}`),
    ...f.correos.map((x) => `Correo: ${x.valor}`),
    ...f.placas.map((x) => `Placa: ${x.valor}`),
    ...f.montos.map((x) => `Monto: ${x.valor}`),
  ].filter(Boolean);
  const risks = f.riesgos.map((r) => r.valor);
  if (!items.length && !risks.length) return null;
  return el('details', { class: 'detected' },
    el('summary', {}, `Datos detectados (${items.length})`, risks.length ? el('span', { class: 'risk-tag' }, ' ⚠ ' + risks.join(', ')) : ''),
    el('ul', {}, ...items.map((t) => el('li', {}, t))));
}

function renderLog() {
  const list = $('#log-list');
  const incidents = vault.log.filter((e) => e.tipo === 'incidente');
  $('#log-empty').hidden = incidents.length > 0;
  const notes = vault.log.filter((e) => e.tipo === 'nota');
  list.replaceChildren(...incidents.slice().reverse().map((e) => {
    const item = el('li', {},
      el('div', {}, el('b', {}, formatDate(e.ocurridoEn)), ' · ', CANALES[e.canal]),
      e.contacto && el('div', {}, 'Desde: ', el('b', {}, e.contacto)),
      e.montoExigido !== null && el('div', {}, 'Exigen: ', el('b', {}, formatSoles(e.montoExigido))),
      (e.medioPago || e.cuentaPago) && el('div', {}, 'Pago: ', MEDIOS_PAGO[e.medioPago] || '', ' ', e.cuentaPago),
      e.mensaje && el('div', { class: 'quote' }, e.mensaje),
      e.descripcion && el('div', {}, e.descripcion),
      ...notes.filter((n) => n.refiereA === e.id).map((n) => el('div', { class: 'note' },
        el('span', { class: 'meta' }, 'Nota del ', formatDate(n.registradoEn), ': '), n.descripcion)),
      el('div', { class: 'meta' }, 'Registrado ', formatDate(e.registradoEn)),
      renderDetected(e),
      el('div', { class: 'meta hash' }, 'Huella: ', e.huella),
    );
    const preview = el('div', { class: 'preview' });
    const actions = el('div', { class: 'actions' },
      ...e.adjuntos.map((a) => el('button', { type: 'button', onclick: () => openAttachment(a, preview) }, 'Ver ', a.nombre)),
      el('button', { type: 'button', onclick: () => addNote(e) }, 'Agregar nota'),
    );
    item.append(actions, preview);
    return item;
  }));
}

async function openAttachment(a, target) {
  try {
    const bytes = await vault.readFile(a.id);
    const url = URL.createObjectURL(new Blob([bytes], { type: a.tipo }));
    objectUrls.add(url);
    let media;
    if (a.tipo.startsWith('image/')) media = el('img', { src: url, alt: a.nombre });
    else if (a.tipo.startsWith('audio/')) media = el('audio', { src: url, controls: '' });
    else if (a.tipo.startsWith('video/')) media = el('video', { src: url, controls: '' });
    else media = el('a', { href: url, download: a.nombre }, 'Descargar ', a.nombre);
    target.replaceChildren(media, el('div', { class: 'meta hash' }, 'SHA-256: ', a.sha256));
  } catch (err) {
    say(err.message, 'err');
  }
}

async function addNote(entry) {
  const text = window.prompt('Escribe la nota o corrección. Los registros no se pueden editar, pero las notas quedan junto al original.');
  if (!text || !text.trim()) return;
  try {
    await vault.add({ tipo: 'nota', refiereA: entry.id, descripcion: text });
    renderLog();
    say('Nota agregada.', 'ok');
  } catch (err) {
    say(err.message, 'err');
  }
}

// ---------- Sesión ----------

/** Abre la bóveda; tras varios intentos fallidos, espera cada vez más. */
async function tryOpen(password) {
  const fails = Number(getPref(FAILS_KEY)) || 0;
  if (fails >= 3) await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** (fails - 3))));
  try {
    const v = await Vault.open(storage, password);
    setPref(FAILS_KEY, null);
    return v;
  } catch (err) {
    setPref(FAILS_KEY, String(fails + 1));
    throw err;
  }
}

function lock() {
  if (recorder) recorder.stop();
  vault = null;
  pendingFiles = [];
  renderPending();
  chatImport = null;
  $('#wa-step2').hidden = true;
  $('#wa-files').value = '';
  // Las pruebas descifradas que se estaban viendo dejan de estar accesibles.
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  $('#log-list').replaceChildren();
  $('#report-body').replaceChildren();
  $('#check-result').textContent = '';
  $('#verify-result').textContent = '';
  $('#form-new').reset();
  plan = null;
  $('#plan').replaceChildren();
  $('#clave-familiar').value = '';
  $('#trip-links').replaceChildren();
  say('');
  // Si se bloquea en medio de un SOS, la pantalla de emergencia sigue visible.
  if (!$('#view-sos').hidden) {
    applyLook(true);
    sosReturn = 'unlock';
  } else {
    showLocked();
  }
}

function showLocked() {
  applyLook(true);
  if (isCamo()) {
    $('#decoy').value = getPref(DECOY_KEY) || '';
    $('#notes-empty').hidden = true;
    show('notes');
  } else {
    show('unlock');
  }
}

function openApp() {
  applyLook(false);
  $('#camo').checked = isCamo();
  show('app');
  resetForm();
  showTab('new');
}

async function wipe() {
  const answer = window.prompt('Esto borrará la bitácora y las pruebas de este teléfono. Escribe BORRAR para confirmar.');
  if (answer !== 'BORRAR') return;
  await Vault.wipe(storage);
  for (const key of [CAMO_KEY, DECOY_KEY, SOS_KEY, TRIP_KEY, FAILS_KEY]) setPref(key, null);
  applyLook(false);
  vault = null;
  show('setup');
  say('Se borró todo.', 'ok');
}

function quickExit() {
  vault = null;
  document.body.replaceChildren();
  window.location.replace(EXIT_URL);
}

// ---------- Eventos ----------

function bind() {
  fillSelect($('#form-new').canal, { '': 'Elige una opción', ...CANALES });
  fillSelect($('#form-new').medioPago, MEDIOS_PAGO);
  renderHelp($('#tab-help'));
  renderHelp($('#help-public'));

  $('#exit').addEventListener('click', quickExit);
  $('#sos').addEventListener('click', openSos);
  renderBlindaje();

  $('#form-trusted').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const c = normalizeContact({ nombre: ev.target.nombre.value, numero: ev.target.numero.value });
      const list = trustedContacts();
      if (list.length >= 5) throw new Error('Máximo 5 contactos de confianza.');
      if (list.some((x) => x.numero === c.numero)) throw new Error('Ese número ya está en tu lista.');
      if (!setPref(SOS_KEY, JSON.stringify([...list, c]))) {
        throw new Error('Este navegador no deja guardar contactos (¿modo privado?). Abre Escudo en una ventana normal.');
      }
      ev.target.reset();
      $('#sos-status').textContent = `${c.nombre} agregado.`;
      renderTrusted();
    } catch (err) {
      $('#sos-status').textContent = err.message;
    }
  });

  $('#form-trip').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const c = trustedContacts()[Number(f.contacto.value)];
    if (!c || f.contacto.value === '') return say('Primero agrega un contacto de confianza con el botón SOS.', 'err');
    const btn = $('button[type=submit]', f);
    try {
      const hasta = nextLimaTime(f.hasta.value);
      busy(btn, true, 'Buscando tu ubicación…');
      const text = tripMessage({ destino: f.destino.value, motivo: f.motivo.value, hasta, ubicacion: await myLocation() });
      if (!setPref(TRIP_KEY, JSON.stringify({ hasta: hasta.toISOString(), nombre: c.nombre, numero: c.numero }))) {
        say('Este navegador no deja guardar el trayecto: si cierras Escudo, no verás el botón "Llegué bien".', 'err');
      }
      linkButtons($('#trip-links'), [c], text);
      $('#trip-links').prepend(el('p', { class: 'hint' }, 'Envía el aviso. Cuando llegues, vuelve aquí y toca "Llegué bien".'));
      say('');
      f.reset();
      renderTrip();
    } catch (err) {
      say(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('#plan').addEventListener('change', async (ev) => {
    const id = ev.target.dataset.plan;
    if (!id || !plan) return;
    plan.hechos[id] = ev.target.checked;
    renderPlanProgress();
    try { await savePlan(); } catch (err) { say(err.message, 'err'); }
  });
  $('#clave-familiar').addEventListener('change', async (ev) => {
    if (!plan) return;
    plan.palabraClave = ev.target.value.trim();
    try { await savePlan(); say('Palabra clave guardada (cifrada).', 'ok'); } catch (err) { say(err.message, 'err'); }
  });
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-goto="help"]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    previousView = $('#view-setup').hidden ? 'unlock' : 'setup';
    show('help');
  }));

  $('#form-setup').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.p1.value !== f.p2.value) return say('Las contraseñas no coinciden.', 'err');
    const btn = $('button[type=submit]', f);
    busy(btn, true, 'Creando…');
    try {
      vault = await Vault.create(storage, f.p1.value);
      await custody('creacion');
      f.reset();
      openApp();
      say('Listo. Tu bitácora está creada y cifrada.', 'ok');
    } catch (err) {
      say(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('#form-unlock').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('button[type=submit]', ev.target);
    busy(btn, true, 'Abriendo…');
    try {
      vault = await tryOpen(ev.target.pw.value);
      ev.target.reset();
      openApp();
    } catch (err) {
      say(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('#form-import-setup').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const btn = $('button[type=submit]', f);
    busy(btn, true, 'Restaurando…');
    try {
      vault = await Vault.importBackup(storage, await f.file.files[0].text(), f.pw.value);
      await custody('restauracion', f.file.files[0].name);
      f.reset();
      openApp();
      say('Copia restaurada.', 'ok');
    } catch (err) {
      say(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('#form-new').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const btn = $('button[type=submit]', f);
    busy(btn, true, 'Guardando…');
    try {
      if (recorder) throw new Error('Detén la grabación antes de guardar.');
      const files = pendingFiles;
      await vault.add({
        ocurridoEn: f.ocurridoEn.value,
        canal: f.canal.value,
        contacto: f.contacto.value,
        montoExigido: f.montoExigido.value,
        medioPago: f.medioPago.value,
        cuentaPago: f.cuentaPago.value,
        mensaje: f.mensaje.value,
        descripcion: f.descripcion.value,
      }, files);
      resetForm();
      say(`Registro guardado${files.length ? ` con ${files.length} prueba(s)` : ''}.`, 'ok');
    } catch (err) {
      say(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('#form-new').files.addEventListener('change', async (ev) => {
    await addPending(ev.target.files);
    ev.target.value = '';
  });
  if (canRecord()) $('#rec').hidden = false;

  $('#wa-files').addEventListener('change', async (ev) => {
    if (!ev.target.files.length) return;
    try {
      chatImport = await loadChat(ev.target.files);
      renderChatImport();
      say('');
    } catch (err) {
      chatImport = null;
      $('#wa-step2').hidden = true;
      say(err.message, 'err');
    }
  });

  $('#form-notes').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = ev.target.pw.value;
    ev.target.reset();
    try {
      vault = await tryOpen(pw);
      openApp();
    } catch {
      $('#notes-empty').hidden = false;
    }
  });
  $('#decoy').addEventListener('input', (ev) => setPref(DECOY_KEY, ev.target.value));
  $('#camo').addEventListener('change', (ev) => {
    setPref(CAMO_KEY, ev.target.checked ? '1' : null);
    say(ev.target.checked
      ? 'Modo camuflado activado. Al cerrar, Escudo se verá como una libreta de notas.'
      : 'Modo camuflado desactivado.', 'ok');
  });

  $('#form-check').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const file = ev.target.file.files[0];
    const out = $('#check-result');
    if (!file || !vault) return;
    out.textContent = 'Calculando huella…';
    const hash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    const hit = findByHash(vault.log, hash);
    out.textContent = hit
      ? `✅ Coincide con la prueba "${hit.adjunto.nombre}" del incidente #${hit.numero} (${formatDate(hit.registro.ocurridoEn)}). Huella: ${hash}`
      : `❌ No coincide con ninguna prueba registrada. Huella: ${hash}`;
  });

  $('#form-password').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.p1.value !== f.p2.value) return say('Las contraseñas no coinciden.', 'err');
    const btn = $('button[type=submit]', f);
    busy(btn, true, 'Cambiando…');
    try {
      await vault.changePassword(f.p1.value);
      await custody('contrasena');
      f.reset();
      say('Contraseña cambiada.', 'ok');
    } catch (err) {
      say(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  const actions = {
    wipe,
    lock,
    back: () => (vault ? openApp() : previousView === 'unlock' ? showLocked() : show(previousView)),
    print: () => window.print(),
    'open-sos': openSos,
    'sos-send': sendSos,
    'sos-back': () => {
      if (vault && sosReturn === 'app') show('app');
      else if (!vault && ['app', 'report', 'unlock', 'notes'].includes(sosReturn)) showLocked();
      else show(sosReturn);
    },
    'trip-clear': () => {
      setPref(TRIP_KEY, null);
      $('#trip-links').replaceChildren();
      renderTrip();
    },
    record: toggleRecording,
    'wa-import': importChat,
    async evidence(btn) {
      if (!window.confirm('El paquete NO está cifrado: cualquiera que lo abra verá las pruebas. Entrégalo solo a la Policía, la Fiscalía o tu abogado, y bórralo de tu celular después. ¿Continuar?')) return;
      busy(btn, true, 'Preparando…');
      try {
        const pkg = await buildEvidencePackage(vault.log, (id) => vault.readFile(id), await reportOptions());
        download(`pruebas-escudo-${stamp()}.zip`, pkg.zip, 'application/zip');
        await custody('paquete', `${pkg.archivos} prueba(s)`);
        say(pkg.problemas.length
          ? `Paquete descargado, pero estas pruebas no coinciden con su huella: ${pkg.problemas.join(', ')}.`
          : `Paquete descargado con ${pkg.archivos} prueba(s).`, pkg.problemas.length ? 'err' : 'ok');
      } finally {
        busy(btn, false);
      }
    },
    async verify(btn) {
      busy(btn, true, 'Comprobando…');
      const r = await vault.verify();
      await custody('verificacion', r.ok ? 'Correcta' : 'Con problemas');
      busy(btn, false);
      $('#verify-result').textContent = r.ok
        ? `Todo en orden: ${vault.log.length} registro(s) sin alteraciones.`
        : `Atención: ${r.rotoEn >= 0 ? `la cadena se rompe en el registro ${r.rotoEn + 1}. ` : ''}${r.archivosAlterados.length ? `Archivos dañados: ${r.archivosAlterados.join(', ')}.` : ''}`;
    },
    async 'report-html'() {
      const html = buildReportBody(vault.log, await reportOptions());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      $('#report-body').replaceChildren(...[...doc.body.childNodes].map((n) => document.adoptNode(n)));
      await custody('informe', 'Vista para imprimir');
      show('report');
    },
    async 'report-download'() {
      download(`informe-escudo-${stamp()}.html`, buildHtmlReport(vault.log, await reportOptions()), 'text/html');
      await custody('informe', 'Descarga HTML');
    },
    async 'report-copy'() {
      const text = buildTextReport(vault.log, await reportOptions());
      try {
        await navigator.clipboard.writeText(text);
        await custody('informe', 'Copiado como texto');
        say('Informe copiado. Pégalo solo donde sea seguro.', 'ok');
      } catch {
        download(`informe-escudo-${stamp()}.txt`, text, 'text/plain');
      }
    },
    async 'report-share'() {
      const text = buildTextReport(vault.log, await reportOptions());
      try {
        await navigator.share({ title: 'Informe de incidentes', text });
        await custody('informe', 'Compartido');
      } catch { /* la persona canceló */ }
    },
    async backup() {
      await custody('copia');
      download(`copia-escudo-${stamp()}.escudo`, await vault.exportBackup(), 'application/json');
      say('Copia descargada. Guárdala en un lugar seguro; necesitarás tu contraseña para abrirla.', 'ok');
    },
  };
  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    try {
      await actions[btn.dataset.action](btn);
    } catch (err) {
      say(err.message, 'err');
    }
  });
  if (navigator.share) $('[data-action="report-share"]').hidden = false;

  // Bloqueo automático si la app queda en segundo plano.
  for (const type of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true });
  }
  setInterval(() => {
    if (vault && !recorder && Date.now() - lastActivity > IDLE_LOCK_MS) lock();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (vault && Date.now() - hiddenAt > AUTO_LOCK_MS) lock();
  });
}

async function start() {
  bind();
  if (!isCryptoAvailable()) {
    say('Este navegador no permite cifrar en esta página. Ábrela desde una dirección https:// o actualiza el navegador.', 'err');
    return;
  }
  if (await Vault.exists(storage)) showLocked();
  else show('setup');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start().catch((err) => say(err.message, 'err'));
