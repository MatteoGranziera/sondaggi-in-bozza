'use strict';

const MAX_OPTIONS = 12;
const WA_URL = 'https://web.whatsapp.com/';
const SLOW_LOAD_MS = 60000;
const LIST_LIMIT = 200;
const DRAFT_VERSION = 3;
const NOTICE_VERSION = 2;
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
const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const time = (t) => timeFmt.format(t);
const when = (t) => (new Date(t).toDateString() === new Date().toDateString() ? 'oggi' : dayFmt.format(t)) + ' alle ' + timeFmt.format(t);
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('it');
const kind = (r) => (r.source === 'group' ? 'gruppo' : r.source === 'number' ? 'numero scritto a mano' : 'contatto');

function normRecipient(r) {
  if (!r || !r.jid) return null;
  const jid = String(r.jid);
  return {
    jid,
    label: String(r.label || jid),
    source: SOURCES.includes(r.source) ? r.source : jid.endsWith('@g.us') ? 'group' : 'contact',
  };
}

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
  let recipient = normRecipient(x.recipient);
  if (!recipient && Array.isArray(x.recipients)) {
    // Up to v2 a draft held a list of recipients, and before v2 the ones already served stayed in it.
    const left = x.recipients.map(normRecipient).filter(Boolean)
      .filter((r) => x.v === 2 || !sends.some((s) => s.ok && s.jid === r.jid));
    recipient = left[0] || null;
  }
  const origin = x.origin && typeof x.origin.chat === 'string'
    ? { chat: x.origin.chat, at: Number(x.origin.at) || 0 } : null;
  return {
    v: DRAFT_VERSION,
    id: String(x.id || uid()),
    question: String(x.question || ''),
    options,
    multiple: !!x.multiple,
    recipient,
    sends,
    origin,
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
let chatPolls = { loading: false, error: '', chat: '', polls: null };
let confirming = false;
let sending = false;
let deleteArmed = false;
let noticeAck = false;

const current = () => drafts.find((d) => d.id === currentId) || null;
const byRecent = () => [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
const cleanOptions = (d) => d.options.map((s) => s.trim()).filter(Boolean);
const sentTo = (d) => new Set(d.sends.filter((s) => s.ok).map((s) => s.jid));
const sameVersion = (s, d) => s.question === d.question.trim()
  && JSON.stringify(s.choices) === JSON.stringify(cleanOptions(d))
  && s.multiple === d.multiple;
const samePoll = (d, p) => d.question.trim() === p.question.trim()
  && JSON.stringify(cleanOptions(d)) === JSON.stringify(p.options.map((o) => o.trim()));

function save() {
  // The import screen is a detour: reopening the panel lands on the list.
  chrome.storage.local.set({ drafts, currentId, view: view === 'import' ? 'list' : view })
    .catch(() => toast('Non riesco a salvare le bozze.'));
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
      if (view === 'import' && chatPolls.polls === null) loadChatPolls();
    } else if (before === 'online') {
      lists.groups = blankList();
      lists.contacts = blankList();
    }
    if (view === 'edit') { renderPicker(); renderSend(); }
    if (view === 'import') renderImport();
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

async function loadList(which) {
  const l = lists[which];
  if (l.loading) return;
  l.loading = true;
  l.error = '';
  renderPickerList();
  try {
    const items = await call(which);
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

async function loadChatPolls() {
  if (chatPolls.loading) return;
  chatPolls.loading = true;
  chatPolls.error = '';
  renderImport();
  try {
    const res = await call('chatPolls');
    chatPolls.chat = res.chat;
    chatPolls.polls = res.polls;
  } catch (e) {
    chatPolls.error = e.message;
    chatPolls.polls = null;
  } finally {
    chatPolls.loading = false;
  }
  renderImport();
}

async function send(d) {
  const r = d.recipient;
  if (!r) return;
  confirming = false;
  sending = true;
  closeEmoji();
  renderSend();
  const question = d.question.trim();
  const choices = cleanOptions(d);
  const multiple = d.multiple;
  let entry;
  try {
    // WhatsApp reads 0 as "any number of answers".
    const out = await call('sendPoll', { chatId: r.jid, name: question, choices, selectableCount: multiple ? 0 : 1 });
    entry = { ok: true, info: out?.id || '' };
  } catch (e) {
    entry = { ok: false, info: e.message };
  }
  d.sends.push({ jid: r.jid, label: r.label, at: Date.now(), question, choices, multiple, ...entry });
  // Each send is a choice of its own: after it, the next recipient is picked again.
  if (entry.ok && d.recipient?.jid === r.jid) d.recipient = null;
  sending = false;
  d.updatedAt = Date.now();
  save();
  if (view === 'edit' && currentId === d.id) renderView();
  toast(entry.ok ? `Inviato a ${r.label}.` : `Non è partito: ${entry.info}`);
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

function go(next, id = currentId) {
  currentId = id;
  view = next;
  confirming = false;
  save();
  renderView();
  window.scrollTo(0, 0);
}

const select = (id) => go(id ? 'edit' : 'list', id);
const back = () => go('list');

function openImport() {
  chatPolls = { loading: false, error: '', chat: '', polls: null };
  go('import');
  if (wa.state === 'online') loadChatPolls();
}

function newDraft(from) {
  const d = normalizeDraft({ id: uid(), v: DRAFT_VERSION, ...from });
  drafts.push(d);
  select(d.id);
  if (!from) document.getElementById('q')?.focus();
  return d;
}

function importPoll(p) {
  newDraft({
    question: p.question,
    options: p.options.slice(0, MAX_OPTIONS),
    multiple: p.multiple,
    origin: { chat: chatPolls.chat, at: p.at },
  });
  toast('Bozza creata dal sondaggio della chat.');
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
  go('list', null);
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

function setRecipient(d, rcp) {
  d.recipient = rcp ? normRecipient(rcp) : null;
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
      h('li', {}, 'Serve a preparare e tenere in ordine i sondaggi. Lavora nella tua scheda di WhatsApp Web, e sondaggi, contatti e registro restano in questo browser: non vanno a nessun server.'),
      h('li', {}, 'Ogni sondaggio parte verso una persona o un gruppo alla volta, solo dopo che hai confermato testo e destinatario.'),
      h('li', {}, 'Mandalo solo a chi ti conosce e se lo aspetta. WhatsApp può limitare o bloccare gli account che inviano messaggi non richiesti.')),
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
  const screens = { edit: () => editView(current()), import: importView, list: listView };
  $('#view').replaceChildren((screens[view] || listView)());
  if (view === 'edit') {
    renderChips();
    renderPicker();
    renderPreview();
    renderSend();
    renderLog();
  }
  if (view === 'import') renderImport();
}

function listView() {
  const items = byRecent();
  return h('div', {},
    h('div', { class: 'list-head' },
      h('h2', {}, 'Sondaggi'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: openImport, title: 'Crea una bozza da un sondaggio della chat aperta in WhatsApp Web' }, 'Da una chat'),
        h('button', { class: 'btn small', onclick: () => newDraft() }, 'Nuovo'))),
    items.length
      ? h('ul', { class: 'drafts' }, items.map((d) => {
          const reached = sentTo(d).size;
          return h('li', {}, h('button', { class: 'draft', onclick: () => select(d.id) },
            h('span', { class: 'dq' }, d.question.trim() || 'Senza domanda'),
            h('span', { class: 'dm' },
              [`${cleanOptions(d).length} opzioni`,
                reached ? `inviato a ${reached}` : 'mai inviato',
                d.recipient && `pronto per ${d.recipient.label}`].filter(Boolean).join(' · '))));
        }))
      : h('div', { class: 'empty' },
          h('p', {}, 'Ancora nessun sondaggio.'),
          h('p', { class: 'note' }, 'Preparane uno con Nuovo, o prendi un sondaggio che c\'è già in una chat con Da una chat.')),
    h('div', { class: 'list-foot' },
      h('button', { class: 'btn ghost small', onclick: exportDrafts, disabled: !drafts.length }, 'Esporta file'),
      h('button', { class: 'btn ghost small', onclick: () => $('#importFile').click() }, 'Importa file')),
    footer());
}

function importView() {
  return h('div', {},
    h('div', { class: 'ed-head' },
      h('button', { class: 'back', onclick: back }, '‹ Sondaggi'),
      h('span', { class: 'saved' }),
      h('button', { class: 'btn ghost small', id: 'btnChatPolls', onclick: loadChatPolls }, 'Aggiorna')),
    h('div', { class: 'card' },
      h('h2', {}, 'Da una chat'),
      h('p', { class: 'note', style: 'margin:0 0 12px' },
        'Apri in WhatsApp Web la chat con il sondaggio, poi scegli quale trasformare in bozza. Il sondaggio in chat resta com\'è.'),
      h('div', { id: 'chatPolls' })));
}

function renderImport() {
  const box = document.getElementById('chatPolls');
  if (!box) return;
  const btn = document.getElementById('btnChatPolls');
  if (btn) btn.disabled = chatPolls.loading || wa.state !== 'online';
  const say = (t) => box.replaceChildren(h('p', { class: 'note pad' }, t));
  if (wa.state !== 'online') return say(statusInfo()[1] + '.');
  if (chatPolls.loading) return say('Cerco i sondaggi nella chat aperta…');
  if (chatPolls.error) return say(chatPolls.error);
  if (chatPolls.polls === null) return say('Premi Aggiorna per cercare i sondaggi nella chat aperta.');
  if (!chatPolls.polls.length) {
    return say(`Nella chat «${chatPolls.chat}» non trovo sondaggi. Se è più indietro, scorri la chat in WhatsApp Web fino a vederlo e premi Aggiorna.`);
  }
  box.replaceChildren(
    h('p', { class: 'f' }, `Chat «${chatPolls.chat}»`),
    h('ul', { class: 'chat-polls' }, chatPolls.polls.map((p) => {
      const known = drafts.some((d) => samePoll(d, p));
      return h('li', {},
        h('div', { class: 'cp-q' }, p.question),
        h('div', { class: 'cp-o' }, p.options.join(' · ')),
        h('div', { class: 'cp-foot' },
          h('span', { class: 'lmeta' }, [
            p.multiple ? 'più risposte' : 'una risposta',
            p.at && when(p.at),
            p.fromMe ? 'tuo' : p.author && 'di ' + p.author,
          ].filter(Boolean).join(' · ')),
          known && h('span', { class: 'tag soft' }, 'già fra le bozze'),
          h('button', { class: 'btn small', onclick: () => importPoll(p) }, 'Crea bozza')));
    })));
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

  const tab = (which, label) => h('button', {
    class: 'tab', role: 'tab', 'data-tab': which, 'aria-selected': String(pickTab === which),
    onclick: () => selectTab(which),
  }, label);

  return h('div', {},
    h('div', { class: 'ed-head' },
      h('button', { class: 'back', onclick: back }, '‹ Sondaggi'),
      h('span', { class: 'saved', id: 'saved' }, 'Salvato alle ' + time(d.updatedAt)),
      h('button', { class: 'btn ghost small', onclick: () => duplicate(d) }, 'Duplica'),
      h('button', { class: 'btn danger small', id: 'btnDelete', onclick: () => remove(d) }, 'Elimina')),

    d.origin && h('p', { class: 'note', style: 'margin:0 0 10px' },
      `Preso dalla chat «${d.origin.chat}»` + (d.origin.at ? `, dove era stato mandato ${when(d.origin.at)}.` : '.')),

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
      h('div', { class: 'f' }, 'Destinatario'),
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
  const r = d.recipient;
  box.replaceChildren(r
    ? h('span', { class: 'chip', title: r.jid },
        h('span', {}, r.label),
        h('small', {}, [kind(r), sentTo(d).has(r.jid) && 'già inviato'].filter(Boolean).join(' · ')),
        h('button', { 'aria-label': 'Togli ' + r.label, onclick: () => setRecipient(d, null) }, '×'))
    : h('span', { class: 'note', style: 'margin:0' }, 'Scegli una persona o un gruppo: il sondaggio parte verso un destinatario alla volta.'));
}

function selectTab(which) {
  pickTab = which;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === which));
  renderPicker();
  if (lists[which].items === null && wa.state === 'online') loadList(which);
  document.querySelector('#picker input')?.focus();
}

// A search that is only a phone number can be picked as it is, in or out of the address book.
function typedNumber(s) {
  const t = s.trim();
  return /^[+\d\s().-]+$/.test(t) ? normalizeNumber(t) : null;
}

function pickTypedNumber(d, jid) {
  setRecipient(d, { jid, label: '+' + jid.split('@')[0], source: 'number' });
  lists.contacts.filter = '';
  const search = document.querySelector('#picker input[type=search]');
  if (search) search.value = '';
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
        if (jid) { e.preventDefault(); pickTypedNumber(d, jid); }
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
    const on = d.recipient?.jid === jid;
    box.append(h('button', { class: 'addnum', disabled: on, onclick: () => pickTypedNumber(d, jid) },
      on ? `${label} è già il destinatario` : `+ Usa il numero ${label}`));
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
    box.append(h('label', { class: 'item' },
      h('input', {
        type: 'radio', name: 'recipient', checked: d.recipient?.jid === i.id,
        onchange: () => setRecipient(d, { jid: i.id, label: i.name, source: contacts ? 'contact' : 'group' }),
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
  const r = d.recipient;
  if (probs.length) box.append(h('ul', { class: 'probs' }, probs.map((p) => h('li', {}, p))));
  const blocked = wa.state === 'online' ? '' : statusInfo()[1] + '.';
  if (!r) box.append(h('p', { class: 'note', style: 'margin:0 0 10px' }, 'Nessun destinatario scelto.'));
  else if (blocked) box.append(h('p', { class: 'note', style: 'margin:0 0 10px' }, blocked));
  const can = !probs.length && !!r && !sending && !blocked;

  if (confirming && can) {
    // The store policy asks for the content and the recipient to be confirmed before sending.
    box.append(h('div', { class: 'confirm-box' },
      h('p', {}, 'Stai per mandare ', h('b', {}, '«' + d.question.trim() + '»'),
        ` (${cleanOptions(d).length} opzioni, ${d.multiple ? 'più risposte' : 'una risposta'}) a `,
        h('b', {}, r.label), ` (${kind(r)}).`),
      sentTo(d).has(r.jid) && h('p', { class: 'note' }, "L'ha già ricevuto: gli arriverà di nuovo."),
      r.source === 'number' && h('p', { class: 'note warn' },
        'Un numero scritto a mano riceve il sondaggio anche se non ti conosce. Mandalo solo a chi se lo aspetta.'),
      h('div', { class: 'confirm' },
        h('button', { class: 'btn', onclick: () => send(d) }, 'Sì, invia'),
        h('button', { class: 'btn ghost', onclick: () => { confirming = false; renderSend(); } }, 'Annulla'))));
  } else {
    box.append(h('button', { class: 'btn send', disabled: !can, onclick: () => { confirming = true; renderSend(); } },
      sending ? 'Invio in corso…' : r ? `Invia a ${r.label}` : 'Invia'));
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
