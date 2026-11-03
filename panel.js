'use strict';

const MAX_OPTIONS = 12;
const WA_URL = 'https://web.whatsapp.com/';
// One poll every few seconds and a small batch at a time: this is for people who know you,
// and WhatsApp limits accounts that send unrequested messages in bulk.
const SEND_GAP_MS = 3000;
const MAX_PER_SEND = 20;
const SLOW_LOAD_MS = 60000;
const LIST_LIMIT = 200;
const DRAFT_VERSION = 2;
const NOTICE_VERSION = 1;
const REPO_URL = 'https://github.com/MatteoGranziera/sondaggi-in-bozza';
const SOURCES = ['group', 'contact', 'number'];

const $ = (s) => document.querySelector(s);

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const time = (t) => timeFmt.format(t);
const when = (t) => (new Date(t).toDateString() === new Date().toDateString() ? 'oggi' : dayFmt.format(t)) + ' alle ' + timeFmt.format(t);
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('it');
const dest = (n) => `${n} ${n === 1 ? 'destinatario' : 'destinatari'}`;

function normalizeDraft(x) {
  const options = (Array.isArray(x.options) ? x.options : []).map(String).slice(0, MAX_OPTIONS);
  while (options.length < 2) options.push('');
  const sends = (Array.isArray(x.sends) ? x.sends : []).filter((s) => s && s.jid).map((s) => ({
    jid: String(s.jid),
    label: String(s.label || s.jid),
    ok: !!s.ok,
    info: String(s.info || ''),
    at: Number(s.at) || Date.now(),
    question: typeof s.question === 'string' ? s.question : null,
    choices: Array.isArray(s.choices) ? s.choices.map(String) : null,
    multiple: typeof s.multiple === 'boolean' ? s.multiple : null,
  }));
  let recipients = (Array.isArray(x.recipients) ? x.recipients : []).filter((r) => r && r.jid)
    .map((r) => ({
      jid: String(r.jid),
      label: String(r.label || r.jid),
      source: SOURCES.includes(r.source) ? r.source : String(r.jid).endsWith('@g.us') ? 'group' : 'contact',
    }));
  // Drafts saved before v2 kept a recipient selected after a successful send.
  if (x.v !== DRAFT_VERSION) recipients = recipients.filter((r) => !sends.some((s) => s.ok && s.jid === r.jid));
  return {
    v: DRAFT_VERSION,
    id: String(x.id || uid()),
    question: String(x.question || ''),
    options,
    multiple: !!x.multiple,
    recipients,
    sends,
    createdAt: Number(x.createdAt) || Date.now(),
    updatedAt: Number(x.updatedAt) || Date.now(),
  };
}

let drafts = [];
let currentId = null;
let view = 'list';
let wa = { state: 'checking', me: '', loadingSince: 0 };
const blankList = () => ({ items: null, loading: false, error: '', filter: '' });
const lists = { groups: blankList(), contacts: blankList() };
let pickTab = 'groups';
let confirming = false;
let sending = false;
let progress = null;
let stopRequested = false;
let deleteArmed = false;
let noticeAck = false;

const current = () => drafts.find((d) => d.id === currentId) || null;
const byRecent = () => [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
const cleanOptions = (d) => d.options.map((s) => s.trim()).filter(Boolean);
const sentTo = (d) => new Set(d.sends.filter((s) => s.ok).map((s) => s.jid));
const isGroup = (jid) => jid.endsWith('@g.us');
const sameVersion = (s, d) => s.question === d.question.trim()
  && JSON.stringify(s.choices) === JSON.stringify(cleanOptions(d))
  && s.multiple === d.multiple;

function save() {
  chrome.storage.local.set({ drafts, currentId, view }).catch(() => toast('Non riesco a salvare le bozze.'));
}

function problems(d) {
  const p = [];
  if (!d.question.trim()) p.push('Scrivi la domanda.');
  const opts = cleanOptions(d);
  if (opts.length < 2) p.push('Servono almeno due opzioni.');
  if (opts.length > MAX_OPTIONS) p.push(`Al massimo ${MAX_OPTIONS} opzioni.`);
  const seen = new Set();
  if (opts.some((o) => { const k = o.toLocaleLowerCase('it'); if (seen.has(k)) return true; seen.add(k); return false; })) {
    p.push('Due opzioni sono uguali: WhatsApp le vuole tutte diverse.');
  }
  if (d.recipients.length > MAX_PER_SEND) {
    p.push(`Al massimo ${MAX_PER_SEND} destinatari per invio: togline qualcuno e mandalo in più volte.`);
  }
  return p;
}

function normalizeNumber(s) {
  s = s.trim();
  if (s.includes('@')) return /^[\w.:-]+@(c\.us|g\.us|lid)$/.test(s) ? s : null;
  let digits = s.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits.length >= 8 ? digits + '@c.us' : null;
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

// ---- WhatsApp Web tab ----

class WaError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function waTab() {
  const tabs = await chrome.tabs.query({ url: WA_URL + '*' });
  if (!tabs.length) return null;
  const win = await chrome.windows.getCurrent().catch(() => null);
  const here = tabs.filter((t) => win && t.windowId === win.id);
  return here.find((t) => t.active) || here[0] || tabs[0];
}

async function call(cmd, args) {
  const tab = await waTab();
  if (!tab) throw new WaError('Apri WhatsApp Web in una scheda.', 'notab');
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'wa', cmd, args });
  } catch {
    throw new WaError('La scheda di WhatsApp Web va ricaricata.', tab.status === 'loading' ? 'loading' : 'noscript');
  }
  if (!res) throw new WaError('La scheda di WhatsApp Web va ricaricata.', 'noscript');
  if (!res.ok) throw new WaError(res.error || 'WhatsApp Web ha rifiutato la richiesta.', 'wa');
  return res.result;
}

async function openWa() {
  const tab = await waTab();
  if (!tab) { await chrome.tabs.create({ url: WA_URL }); return; }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function reloadWa() {
  const tab = await waTab();
  if (tab) await chrome.tabs.reload(tab.id);
  refresh();
}

let refreshTimer = null;
let refreshing = false;
let refreshAgain = false;

async function refresh() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  clearTimeout(refreshTimer);
  const before = wa.state;
  try {
    const s = await call('state');
    wa.me = s.me || '';
    wa.state = !s.ready ? 'loading' : !s.authenticated ? 'login' : !s.mainReady ? 'syncing' : 'online';
  } catch (e) {
    wa.state = e.code === 'notab' || e.code === 'noscript' ? e.code : 'loading';
  }
  if (wa.state === 'loading') wa.loadingSince ||= Date.now();
  else wa.loadingSince = 0;

  if (wa.state !== before) {
    if (wa.state === 'online') {
      if (lists.groups.items === null) loadList('groups');
      if (pickTab === 'contacts' && lists.contacts.items === null) loadList('contacts');
    } else if (before === 'online') {
      lists.groups = blankList();
      lists.contacts = blankList();
    }
    if (view === 'edit') { renderPicker(); renderSend(); }
  }
  renderStatus();
  refreshing = false;
  if (refreshAgain) { refreshAgain = false; refresh(); return; }
  refreshTimer = setTimeout(refresh, wa.state === 'online' ? 30000 : 3000);
}

function statusInfo() {
  switch (wa.state) {
    case 'notab':
      return ['err', 'WhatsApp Web non è aperto', 'Apri', openWa, ''];
    case 'noscript':
      return ['err', 'WhatsApp Web va ricaricato', 'Ricarica', reloadWa, "La scheda era aperta da prima dell'estensione: basta ricaricarla una volta."];
    case 'loading': {
      const slow = wa.loadingSince && Date.now() - wa.loadingSince > SLOW_LOAD_MS;
      return ['wait', 'WhatsApp Web si sta caricando…', slow ? 'Ricarica' : '', slow ? reloadWa : null,
        slow ? 'Ci sta mettendo troppo. Se resta così anche dopo aver ricaricato, WA-JS non funziona con questa versione di WhatsApp Web e va aggiornato.' : ''];
    }
    case 'login':
      return ['wait', 'WhatsApp non è collegato', 'Mostra il QR', openWa, 'Inquadra il QR nella scheda di WhatsApp Web con il telefono.'];
    case 'syncing':
      return ['wait', 'Sincronizzo le chat…', '', null, ''];
    case 'online':
      return ['online', 'Collegato' + (wa.me ? ' come +' + wa.me.split('@')[0].split(':')[0] : ''), '', null, ''];
    default:
      return ['', 'Controllo WhatsApp Web…', '', null, ''];
  }
}

function renderStatus() {
  const [cls, text, actionLabel, action, note] = statusInfo();
  const pill = $('#pill');
  pill.className = 'pill ' + cls;
  pill.textContent = text;
  const btn = $('#statusAction');
  btn.hidden = !action;
  btn.textContent = actionLabel;
  btn.onclick = action;
  $('#statusNote').hidden = !note;
  $('#statusNote').textContent = note;
}

async function loadList(kind) {
  const l = lists[kind];
  if (l.loading) return;
  l.loading = true;
  l.error = '';
  renderPickerList();
  try {
    const items = await call(kind);
    l.items = items.filter((i) => i && i.id)
      .map((i) => ({ id: i.id, name: String(i.name || i.id), phone: i.phone || '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
  } catch (e) {
    l.error = e.message;
  } finally {
    l.loading = false;
  }
  renderPickerList();
}

async function send(d) {
  confirming = false;
  sending = true;
  stopRequested = false;
  closeEmoji();
  const question = d.question.trim();
  const choices = cleanOptions(d);
  const multiple = d.multiple;
  // WhatsApp reads 0 as "any number of answers".
  const args = { name: question, choices, selectableCount: multiple ? 0 : 1 };
  const batch = d.recipients.slice(0, MAX_PER_SEND);
  progress = { done: 0, total: batch.length };
  let failed = 0;
  renderSend();
  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    if (i > 0) await sleep(SEND_GAP_MS);
    if (stopRequested) break;
    let entry;
    try {
      const out = await call('sendPoll', { chatId: r.jid, ...args });
      entry = { ok: true, info: out?.id || '' };
    } catch (e) {
      entry = { ok: false, info: e.message };
    }
    d.sends.push({ jid: r.jid, label: r.label, at: Date.now(), question, choices, multiple, ...entry });
    if (entry.ok) d.recipients = d.recipients.filter((x) => x.jid !== r.jid);
    else failed++;
    progress.done = i + 1;
    save();
    if (view === 'edit' && currentId === d.id) { renderChips(); renderPickerList(); renderSend(); renderLog(); }
  }
  const stopped = stopRequested && progress.done < progress.total;
  sending = false;
  progress = null;
  stopRequested = false;
  d.updatedAt = Date.now();
  save();
  renderView();
  if (stopped) toast('Invio fermato: chi non l\'ha ricevuto resta fra i destinatari.');
  else toast(failed === 0 ? 'Sondaggio inviato.'
    : failed === 1 ? '1 invio non riuscito: resta fra i destinatari, trovi il motivo in fondo.'
    : `${failed} invii non riusciti: restano fra i destinatari, trovi il motivo in fondo.`);
}

// ---- drafts ----

function touch(d) {
  d.updatedAt = Date.now();
  save();
  renderPreview();
  renderSend();
  renderLog();
  const s = document.getElementById('saved');
  if (s) s.textContent = 'Salvato alle ' + time(d.updatedAt);
}

function select(id) {
  currentId = id;
  view = id ? 'edit' : 'list';
  confirming = false;
  save();
  renderView();
  window.scrollTo(0, 0);
}

function back() {
  view = 'list';
  confirming = false;
  save();
  renderView();
}

function newDraft() {
  const d = normalizeDraft({ id: uid(), v: DRAFT_VERSION });
  drafts.push(d);
  select(d.id);
  document.getElementById('q')?.focus();
}

function duplicate(src) {
  const d = normalizeDraft({ ...structuredClone(src), id: uid(), sends: [], createdAt: Date.now(), updatedAt: Date.now() });
  drafts.push(d);
  select(d.id);
  toast('Copia creata.');
}

function remove(d) {
  if (!deleteArmed) {
    deleteArmed = true;
    document.getElementById('btnDelete').textContent = 'Confermi?';
    setTimeout(() => {
      deleteArmed = false;
      const b = document.getElementById('btnDelete');
      if (b) b.textContent = 'Elimina';
    }, 3000);
    return;
  }
  drafts = drafts.filter((x) => x.id !== d.id);
  currentId = null;
  back();
}

function focusOption(i) {
  document.querySelector(`#opts input[data-i="${i}"]`)?.focus();
}

function rerenderKeepingScroll() {
  const y = window.scrollY;
  renderView();
  window.scrollTo(0, y);
}

function addOption(d, at) {
  if (d.options.length >= MAX_OPTIONS) { toast(`WhatsApp accetta al massimo ${MAX_OPTIONS} opzioni.`); return; }
  d.options.splice(at, 0, '');
  touch(d);
  rerenderKeepingScroll();
  focusOption(at);
}

function removeOption(d, i) {
  d.options.splice(i, 1);
  touch(d);
  rerenderKeepingScroll();
  focusOption(Math.min(i, d.options.length - 1));
}

function moveOption(d, i, dir) {
  const j = i + dir;
  [d.options[i], d.options[j]] = [d.options[j], d.options[i]];
  touch(d);
  rerenderKeepingScroll();
  focusOption(j);
}

function toggleRecipient(d, rcp, on) {
  d.recipients = d.recipients.filter((r) => r.jid !== rcp.jid);
  if (on) d.recipients.push({ jid: rcp.jid, label: rcp.label, source: rcp.source });
  confirming = false;
  touch(d);
  renderChips();
  renderPickerList();
}

// ---- emoji ----

let picker = null;
let emojiTarget = null;
let emojiBox = null;
// The field the caret was last in: an emoji goes at its caret, any other field gets it at the end.
let lastField = null;
document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('#q, #opts input')) lastField = e.target;
});

function smiley() {
  const s = document.createElement('span');
  s.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r="1.15" fill="currentColor"/><circle cx="15" cy="10" r="1.15" fill="currentColor"/><path d="M8.3 14a4.4 4.4 0 0 0 7.4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  return s.firstChild;
}

function withEmoji(field, popAfter) {
  return h('div', { class: 'with-emoji' }, field,
    h('button', {
      type: 'button', class: 'emoji-btn', title: 'Emoji', 'aria-label': "Inserisci un'emoji",
      onclick: (e) => { e.stopPropagation(); toggleEmoji(field, popAfter ? popAfter() : field.parentElement); },
    }, smiley()));
}

function toggleEmoji(field, after) {
  if (emojiTarget === field) { closeEmoji(true); return; }
  closeEmoji();
  if (!picker) {
    if (!window.createEmojiPicker) { toast('Le emoji si stanno ancora caricando, riprova tra un attimo.'); return; }
    picker = window.createEmojiPicker();
    picker.addEventListener('emoji-click', (e) => insertEmoji(e.detail.unicode));
  }
  emojiTarget = field;
  emojiBox = h('div', { class: 'emoji-pop' }, picker);
  after.after(emojiBox);
  field.parentElement.classList.add('emoji-open');
  emojiBox.scrollIntoView({ block: 'nearest' });
  setTimeout(() => picker.shadowRoot?.querySelector('input[type=search]')?.focus(), 50);
}

function insertEmoji(text) {
  const f = emojiTarget;
  if (!f || !f.isConnected) { closeEmoji(); return; }
  const atCaret = lastField === f;
  const a = atCaret ? f.selectionStart : f.value.length;
  const b = atCaret ? f.selectionEnd : a;
  f.value = f.value.slice(0, a) + text + f.value.slice(b);
  f.setSelectionRange(a + text.length, a + text.length);
  lastField = f;
  f.dispatchEvent(new Event('input', { bubbles: true }));
}

function closeEmoji(refocus) {
  if (!emojiTarget) return;
  const f = emojiTarget;
  f.parentElement?.classList.remove('emoji-open');
  emojiBox?.remove();
  emojiTarget = null;
  emojiBox = null;
  if (refocus && f.isConnected) f.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && emojiTarget) { e.preventDefault(); closeEmoji(true); }
});
document.addEventListener('click', (e) => {
  if (!emojiTarget) return;
  const path = e.composedPath();
  if (!path.includes(emojiBox) && !path.includes(emojiTarget)) closeEmoji();
});

// ---- rendering ----

function noticeView() {
  return h('div', { class: 'card notice' },
    h('h2', {}, 'Prima di cominciare'),
    h('ul', {},
      h('li', {}, 'Sondaggi in bozza è un progetto indipendente: non è di WhatsApp né di Meta e non è affiliato a loro.'),
      h('li', {}, 'Lavora nella tua scheda di WhatsApp Web. Sondaggi, contatti e registro restano in questo browser: non vanno a nessun server.'),
      h('li', {}, 'Mandali solo a gruppi e persone che ti conoscono e se li aspettano. WhatsApp può limitare o bloccare gli account che inviano messaggi non richiesti.'),
      h('li', {}, `Non è fatto per gli invii di massa: al massimo ${MAX_PER_SEND} destinatari per volta, uno ogni ${SEND_GAP_MS / 1000} secondi, e ogni invio va confermato.`)),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn',
        onclick: () => {
          noticeAck = true;
          chrome.storage.local.set({ noticeAck: NOTICE_VERSION }).catch(() => {});
          renderView();
        },
      }, 'Ho capito'),
      h('a', { class: 'btn ghost', href: REPO_URL + '/blob/main/PRIVACY.md', target: '_blank', rel: 'noopener' }, 'Privacy')));
}

function footer() {
  return h('p', { class: 'foot' },
    'Progetto indipendente, non affiliato a WhatsApp né a Meta. ',
    h('a', { href: REPO_URL + '/blob/main/PRIVACY.md', target: '_blank', rel: 'noopener' }, 'Privacy'),
    ' · ',
    h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Codice sorgente'));
}

function renderView() {
  closeEmoji();
  deleteArmed = false;
  if (!noticeAck) { $('#view').replaceChildren(noticeView()); return; }
  if (view === 'edit' && !current()) view = 'list';
  $('#view').replaceChildren(view === 'edit' ? editView(current()) : listView());
  if (view === 'edit') {
    renderChips();
    renderPicker();
    renderPreview();
    renderSend();
    renderLog();
  }
}

function listView() {
  const items = byRecent();
  return h('div', {},
    h('div', { class: 'list-head' },
      h('h2', {}, 'Sondaggi'),
      h('button', { class: 'btn small', onclick: newDraft }, 'Nuovo')),
    items.length
      ? h('ul', { class: 'drafts' }, items.map((d) => {
          const reached = sentTo(d).size;
          const waiting = d.recipients.length;
          return h('li', {}, h('button', { class: 'draft', onclick: () => select(d.id) },
            h('span', { class: 'dq' }, d.question.trim() || 'Senza domanda'),
            h('span', { class: 'dm' },
              [`${cleanOptions(d).length} opzioni`,
                reached && `inviato a ${reached}`,
                waiting && `${waiting} da inviare`].filter(Boolean).join(' · '))));
        }))
      : h('div', { class: 'empty' },
          h('p', {}, 'Ancora nessun sondaggio.'),
          h('p', { class: 'note' }, 'Preparane uno: lo modifichi quando vuoi e lo mandi a chi vuoi, anche più volte.')),
    h('div', { class: 'list-foot' },
      h('button', { class: 'btn ghost small', onclick: exportDrafts, disabled: !drafts.length }, 'Esporta'),
      h('button', { class: 'btn ghost small', onclick: () => $('#importFile').click() }, 'Importa')),
    footer());
}

function editView(d) {
  const opts = h('div', { id: 'opts' });
  d.options.forEach((o, i) => {
    const input = h('input', {
      type: 'text', value: o, 'data-i': i,
      placeholder: `Opzione ${i + 1}`, 'aria-label': `Opzione ${i + 1}`,
      oninput: (e) => { d.options[i] = e.target.value; touch(d); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(d, i + 1); } },
    });
    const row = h('div', { class: 'opt' },
      h('span', { class: 'opt-n' }, i + 1),
      withEmoji(input, () => row),
      h('button', { class: 'icon', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => moveOption(d, i, -1) }, '↑'),
      h('button', { class: 'icon', title: 'Sposta giù', 'aria-label': 'Sposta giù', disabled: i === d.options.length - 1, onclick: () => moveOption(d, i, 1) }, '↓'),
      h('button', { class: 'icon', title: 'Togli', 'aria-label': 'Togli opzione', disabled: d.options.length <= 2, onclick: () => removeOption(d, i) }, '×'));
    opts.append(row);
  });

  const radio = (val, text) => h('label', {},
    h('input', { type: 'radio', name: 'multi', checked: d.multiple === val, onchange: () => { d.multiple = val; touch(d); } }),
    text);

  const tab = (kind, label) => h('button', {
    class: 'tab', role: 'tab', 'data-tab': kind, 'aria-selected': String(pickTab === kind),
    onclick: () => selectTab(kind),
  }, label);

  return h('div', {},
    h('div', { class: 'ed-head' },
      h('button', { class: 'back', onclick: back }, '‹ Sondaggi'),
      h('span', { class: 'saved', id: 'saved' }, 'Salvato alle ' + time(d.updatedAt)),
      h('button', { class: 'btn ghost small', onclick: () => duplicate(d) }, 'Duplica'),
      h('button', { class: 'btn danger small', id: 'btnDelete', onclick: () => remove(d) }, 'Elimina')),

    d.sends.some((s) => s.ok) && h('div', { class: 'infobar' },
      'Su WhatsApp un sondaggio inviato non si può più modificare. Le modifiche che fai qui valgono per i prossimi invii.'),

    h('div', { class: 'card' },
      h('div', { class: 'field' },
        h('label', { class: 'f', for: 'q' }, 'Domanda'),
        withEmoji(h('textarea', {
          id: 'q', class: 'q', rows: 2,
          placeholder: 'Es. Quando ci vediamo per la cena?',
          oninput: (e) => { d.question = e.target.value; touch(d); },
        }, d.question))),
      h('div', { class: 'field' },
        h('div', { class: 'f' }, 'Opzioni'),
        opts,
        h('button', { class: 'btn ghost small', disabled: d.options.length >= MAX_OPTIONS, onclick: () => addOption(d, d.options.length) }, '+ Aggiungi opzione'),
        h('p', { class: 'note' }, `Da 2 a ${MAX_OPTIONS}, tutte diverse. Invio su un'opzione ne aggiunge una sotto.`)),
      h('div', { class: 'field' },
        h('div', { class: 'f' }, 'Risposte'),
        h('div', { class: 'radio' }, radio(false, 'Una sola'), radio(true, 'Più di una')))),

    h('div', { class: 'card' },
      h('div', { class: 'f' }, 'Destinatari'),
      h('div', { class: 'chips', id: 'chips' }),
      h('div', { class: 'tabs', role: 'tablist' }, tab('groups', 'Gruppi'), tab('contacts', 'Contatti')),
      h('div', { id: 'picker' })),

    h('div', { class: 'card' },
      h('h2', {}, 'Anteprima'),
      h('div', { id: 'preview', class: 'chatbg' })),

    h('div', { class: 'card' },
      h('h2', {}, 'Invio'),
      h('div', { id: 'sendBox' })),

    h('div', { class: 'card', id: 'logCard', hidden: true },
      h('div', { class: 'h2row' }, h('h2', {}, 'Invii'), h('span', { id: 'logCount' })),
      h('div', { id: 'log' })));
}

function renderChips() {
  const box = document.getElementById('chips');
  const d = current();
  if (!box || !d) return;
  const sent = sentTo(d);
  box.replaceChildren(...(d.recipients.length
    ? d.recipients.map((r) => h('span', { class: 'chip', title: r.jid },
        h('span', {}, r.label),
        sent.has(r.jid) && h('small', {}, 'già inviato'),
        h('button', { 'aria-label': 'Togli ' + r.label, onclick: () => toggleRecipient(d, r, false) }, '×')))
    : [h('span', { class: 'note', style: 'margin:0' }, d.sends.some((s) => s.ok)
        ? 'Scegli a chi altro mandarlo.'
        : 'Scegli a chi mandarlo: un gruppo, un contatto o un numero.')]));
}

function selectTab(kind) {
  pickTab = kind;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === kind));
  renderPicker();
  if (lists[kind].items === null && wa.state === 'online') loadList(kind);
  document.querySelector('#picker input')?.focus();
}

// A search that is only a phone number can be added as it is, in or out of the address book.
function typedNumber(s) {
  const t = s.trim();
  return /^[+\d\s().-]+$/.test(t) ? normalizeNumber(t) : null;
}

function addTypedNumber(d, jid) {
  toggleRecipient(d, { jid, label: '+' + jid.split('@')[0], source: 'number' }, true);
  lists.contacts.filter = '';
  const search = document.querySelector('#picker input[type=search]');
  if (search) { search.value = ''; search.focus(); }
  renderPickerList();
}

function renderPicker() {
  const box = document.getElementById('picker');
  const d = current();
  if (!box || !d) return;
  const l = lists[pickTab];
  const contacts = pickTab === 'contacts';
  box.replaceChildren(h('div', { class: 'groups' },
    h('input', {
      type: 'search', value: l.filter,
      placeholder: contacts ? 'Cerca un contatto o scrivi un numero' : 'Cerca un gruppo',
      'aria-label': contacts ? 'Cerca un contatto o scrivi un numero' : 'Cerca un gruppo',
      oninput: (e) => { l.filter = e.target.value; renderPickerList(); },
      onkeydown: (e) => {
        if (e.key !== 'Enter' || !contacts) return;
        const jid = typedNumber(l.filter);
        if (jid) { e.preventDefault(); addTypedNumber(d, jid); }
      },
    }),
    h('div', { class: 'glist', id: 'pickList' }),
    h('div', { class: 'gfoot' },
      h('span', { id: 'pickCount' }),
      h('button', { class: 'btn ghost small', id: 'btnReload', onclick: () => loadList(pickTab) }, 'Aggiorna'))));
  renderPickerList();
}

function renderPickerList() {
  const box = document.getElementById('pickList');
  const d = current();
  if (!box || !d) return;
  const l = lists[pickTab];
  const contacts = pickTab === 'contacts';
  const noun = contacts ? 'contatti' : 'gruppi';
  document.getElementById('btnReload').disabled = l.loading || wa.state !== 'online';
  document.getElementById('pickCount').textContent = l.items ? `${l.items.length} ${noun}` : '';
  box.replaceChildren();
  const say = (t) => box.append(h('p', { class: 'note pad' }, t));

  const jid = contacts ? typedNumber(l.filter) : null;
  if (jid && !(l.items || []).some((i) => i.id === jid)) {
    const label = '+' + jid.split('@')[0];
    const on = d.recipients.some((r) => r.jid === jid);
    box.append(h('button', { class: 'addnum', disabled: on, onclick: () => addTypedNumber(d, jid) },
      on ? `${label} è già fra i destinatari` : `+ Aggiungi il numero ${label}`));
  }
  const orType = contacts ? ' Puoi comunque scrivere un numero qui sopra.' : '';
  if (l.loading) return say(`Carico i ${noun}…`);
  if (l.error) return say(l.error.replace(/\s*$/, '').replace(/[^.!?]$/, '$&.') + orType);
  if (l.items === null) {
    return say((wa.state === 'online' ? `Premi Aggiorna per vedere i ${noun}.` : `Quando WhatsApp Web è collegato qui compaiono i tuoi ${noun}.`) + orType);
  }
  const q = fold(l.filter.trim());
  const qd = l.filter.replace(/\D/g, '');
  const matches = l.items.filter((i) => !q || fold(i.name).includes(q) || (qd.length >= 3 && i.phone.includes(qd)));
  if (!matches.length) {
    if (jid) return;
    return say(l.items.length ? 'Nessun risultato.' + orType
      : contacts ? 'WhatsApp Web non ha dato contatti. Scrivi un numero qui sopra.' : 'Non sei in nessun gruppo in cui puoi scrivere.');
  }
  const sent = sentTo(d);
  for (const i of matches.slice(0, LIST_LIMIT)) {
    const on = d.recipients.some((r) => r.jid === i.id);
    box.append(h('label', { class: 'item' },
      h('input', {
        type: 'checkbox', checked: on,
        onchange: (e) => toggleRecipient(d, { jid: i.id, label: i.name, source: contacts ? 'contact' : 'group' }, e.target.checked),
      }),
      h('span', { class: 'iname' }, h('span', {}, i.name), i.phone && i.name !== '+' + i.phone && h('small', {}, '+' + i.phone)),
      sent.has(i.id) && h('span', { class: 'tag soft' }, 'inviato')));
  }
  if (matches.length > LIST_LIMIT) say(`Altri ${matches.length - LIST_LIMIT}: scrivi per restringere la ricerca.`);
}

function renderPreview() {
  const box = document.getElementById('preview');
  const d = current();
  if (!box || !d) return;
  const opts = cleanOptions(d);
  box.replaceChildren(h('div', { class: 'bubble' },
    h('div', { class: 'pq' }, d.question.trim() || 'La tua domanda'),
    h('div', { class: 'phint' }, d.multiple ? 'Seleziona una o più opzioni' : "Seleziona un'opzione"),
    (opts.length ? opts : ['Opzione 1', 'Opzione 2']).map((o) => h('div', { class: 'popt' }, h('span', { class: d.multiple ? 'mark sq' : 'mark' }), o)),
    h('div', { class: 'pfoot' }, 'Visualizza voti')));
}

function renderSend() {
  const box = document.getElementById('sendBox');
  const d = current();
  if (!box || !d) return;
  box.replaceChildren();
  const probs = problems(d);
  const n = d.recipients.length;
  const sent = sentTo(d);
  const again = d.recipients.filter((r) => sent.has(r.jid)).length;
  if (probs.length) box.append(h('ul', { class: 'probs' }, probs.map((p) => h('li', {}, p))));
  const blocked = wa.state === 'online' ? '' : statusInfo()[1] + '.';
  if (!n) box.append(h('p', { class: 'note', style: 'margin:0 0 10px' }, 'Nessun destinatario scelto.'));
  else if (blocked) box.append(h('p', { class: 'note', style: 'margin:0 0 10px' }, blocked));
  const can = !probs.length && n > 0 && !sending && !blocked;

  if (sending && progress) {
    box.append(h('div', { class: 'confirm' },
      h('span', {}, stopRequested
        ? 'Mi fermo dopo questo invio…'
        : `Invio ${Math.min(progress.done + 1, progress.total)} di ${progress.total}…`),
      !stopRequested && h('button', { class: 'btn ghost', onclick: () => { stopRequested = true; renderSend(); } }, 'Ferma')));
    return;
  }

  if (confirming && can) {
    // The store policy asks for the content and every recipient to be confirmed before sending.
    const typed = d.recipients.filter((r) => r.source === 'number').length;
    box.append(h('div', { class: 'confirm-box' },
      h('p', {}, 'Stai per mandare ', h('b', {}, '«' + d.question.trim() + '»'),
        ` (${cleanOptions(d).length} opzioni, ${d.multiple ? 'più risposte' : 'una risposta'}) a:`),
      h('ul', { class: 'confirm-list' }, d.recipients.map((r) => h('li', {},
        h('span', {}, r.label),
        h('small', {}, [
          r.source === 'group' ? 'gruppo' : r.source === 'number' ? 'numero scritto a mano' : 'contatto',
          sent.has(r.jid) && "l'ha già ricevuto",
        ].filter(Boolean).join(' · '))))),
      again > 0 && h('p', { class: 'note' }, again === 1
        ? "Uno dei destinatari l'ha già ricevuto: gli arriverà di nuovo."
        : `${again} destinatari l'hanno già ricevuto: gli arriverà di nuovo.`),
      typed > 0 && h('p', { class: 'note warn' },
        'Un numero scritto a mano riceve il sondaggio anche se non ti conosce. Mandalo solo a chi se lo aspetta.'),
      h('div', { class: 'confirm' },
        h('button', { class: 'btn', onclick: () => send(d) }, 'Sì, invia'),
        h('button', { class: 'btn ghost', onclick: () => { confirming = false; renderSend(); } }, 'Annulla'))));
  } else {
    box.append(h('button', { class: 'btn', disabled: !can, onclick: () => { confirming = true; renderSend(); } },
      n ? `Invia a ${dest(n)}` : 'Invia'));
  }
}

function renderLog() {
  const card = document.getElementById('logCard');
  const box = document.getElementById('log');
  const d = current();
  if (!card || !box || !d) return;
  card.hidden = !d.sends.length;
  if (!d.sends.length) return;
  const ok = d.sends.filter((s) => s.ok).length;
  const ko = d.sends.length - ok;
  document.getElementById('logCount').textContent = [
    ok && `${ok} ${ok === 1 ? 'riuscito' : 'riusciti'}`,
    ko && `${ko} non ${ko === 1 ? 'riuscito' : 'riusciti'}`,
  ].filter(Boolean).join(' · ');
  box.replaceChildren(h('ul', { class: 'log' }, [...d.sends].sort((a, b) => b.at - a.at).map((s) => h('li', {},
    h('div', { class: 'lrow' },
      h('span', { class: 'lname', title: s.jid }, s.label),
      h('span', { class: s.ok ? 'ok' : 'ko' }, s.ok ? 'inviato' : 'non riuscito')),
    h('div', { class: 'lmeta' }, when(s.at), !s.ok && s.info && ' · ' + s.info),
    s.question !== null && !sameVersion(s, d) && h('div', { class: 'lmeta' }, 'Versione precedente: «' + s.question + '»')))));
}

// ---- import, export ----

function exportDrafts() {
  const blob = new Blob([JSON.stringify(drafts, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `sondaggi-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const list = JSON.parse(await f.text());
    if (!Array.isArray(list)) throw new Error();
    let n = 0;
    for (const x of list) {
      if (!x || typeof x.id !== 'string') continue;
      const d = normalizeDraft(x);
      const i = drafts.findIndex((y) => y.id === d.id);
      if (i >= 0) drafts[i] = d; else drafts.push(d);
      n++;
    }
    save();
    renderView();
    toast(`${n} sondaggi importati.`);
  } catch {
    toast('Il file non è un export di questa estensione.');
  }
  e.target.value = '';
});

// ---- start ----

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'wa-state') refresh();
});
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status && tab.url && tab.url.startsWith(WA_URL)) refresh();
});
chrome.tabs.onRemoved.addListener(() => refresh());

(async () => {
  const stored = await chrome.storage.local.get(['drafts', 'currentId', 'view', 'noticeAck']).catch(() => ({}));
  noticeAck = stored.noticeAck === NOTICE_VERSION;
  drafts = Array.isArray(stored.drafts) ? stored.drafts.filter(Boolean).map(normalizeDraft) : [];
  currentId = drafts.some((d) => d.id === stored.currentId) ? stored.currentId : null;
  view = stored.view === 'edit' && currentId ? 'edit' : 'list';
  renderStatus();
  renderView();
  refresh();
})();
