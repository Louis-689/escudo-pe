// Interfaz de Escudo. Toda la lógica sensible vive en js/core/ y tiene tests.

import { Vault } from './core/vault.js';
import { IndexedDBStorage } from './core/storage.js';
import { isCryptoAvailable } from './core/crypto.js';
import { CANALES, MEDIOS_PAGO, formatSoles } from './core/model.js';
import { buildTextReport, buildHtmlReport, buildReportBody, formatDate } from './core/report.js';
import { CONTACTOS, PASOS, VERIFICADO } from './data/contacts.js';

const storage = new IndexedDBStorage();
const AUTO_LOCK_MS = 2 * 60 * 1000;
const EXIT_URL = 'https://www.google.com/search?q=clima+lima';

let vault = null;
let hiddenAt = 0;
let previousView = 'setup';

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
  if (tab === 'new') resetForm();
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
  form.ocurridoEn.value = localDateTimeValue();
  form.ocurridoEn.max = localDateTimeValue(new Date(Date.now() + 60 * 1000));
}

async function readFiles(fileList) {
  const out = [];
  for (const f of fileList) {
    out.push({ nombre: f.name, tipo: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  return out;
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

// ---------- Bitácora ----------

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

function lock() {
  vault = null;
  $('#log-list').replaceChildren();
  $('#report-body').replaceChildren();
  $('#form-new').reset();
  show('unlock');
}

function openApp() {
  show('app');
  showTab('new');
}

async function wipe() {
  const answer = window.prompt('Esto borrará la bitácora y las pruebas de este teléfono. Escribe BORRAR para confirmar.');
  if (answer !== 'BORRAR') return;
  await Vault.wipe(storage);
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
      vault = await Vault.open(storage, ev.target.pw.value);
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
      const files = await readFiles(f.files.files);
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

  $('#form-password').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.p1.value !== f.p2.value) return say('Las contraseñas no coinciden.', 'err');
    const btn = $('button[type=submit]', f);
    busy(btn, true, 'Cambiando…');
    try {
      await vault.changePassword(f.p1.value);
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
    back: () => (vault ? openApp() : show(previousView)),
    print: () => window.print(),
    async verify(btn) {
      busy(btn, true, 'Comprobando…');
      const r = await vault.verify();
      busy(btn, false);
      $('#verify-result').textContent = r.ok
        ? `Todo en orden: ${vault.log.length} registro(s) sin alteraciones.`
        : `Atención: ${r.rotoEn >= 0 ? `la cadena se rompe en el registro ${r.rotoEn + 1}. ` : ''}${r.archivosAlterados.length ? `Archivos dañados: ${r.archivosAlterados.join(', ')}.` : ''}`;
    },
    async 'report-html'() {
      const html = buildReportBody(vault.log, { verificacion: await vault.verify() });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      $('#report-body').replaceChildren(...[...doc.body.childNodes].map((n) => document.adoptNode(n)));
      show('report');
    },
    async 'report-download'() {
      download(`informe-escudo-${stamp()}.html`, buildHtmlReport(vault.log, { verificacion: await vault.verify() }), 'text/html');
    },
    async 'report-copy'() {
      const text = buildTextReport(vault.log, { verificacion: await vault.verify() });
      try {
        await navigator.clipboard.writeText(text);
        say('Informe copiado. Pégalo solo donde sea seguro.', 'ok');
      } catch {
        download(`informe-escudo-${stamp()}.txt`, text, 'text/plain');
      }
    },
    async 'report-share'() {
      const text = buildTextReport(vault.log, { verificacion: await vault.verify() });
      try {
        await navigator.share({ title: 'Informe de incidentes', text });
      } catch { /* la persona canceló */ }
    },
    async backup() {
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
  show((await Vault.exists(storage)) ? 'unlock' : 'setup');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start().catch((err) => say(err.message, 'err'));
