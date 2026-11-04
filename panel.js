'use strict';

const { t, locale } = window.PollI18n;
document.documentElement.lang = locale;

const MAX_OPTIONS = 12;
const WA_URL = 'https://web.whatsapp.com/';
const SLOW_LOAD_MS = 60000;
const DRAFT_VERSION = 4;
const NOTICE_VERSION = 3;
const REPO_URL = 'https://github.com/MatteoGranziera/sondaggi-in-bozza';

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
const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
const time = (t) => timeFmt.format(t);
const when = (timestamp) => (new Date(timestamp).toDateString() === new Date().toDateString() ? t("oggi") : dayFmt.format(timestamp)) + t(" alle ") + timeFmt.format(timestamp);

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
  const origin = x.origin && typeof x.origin.chat === 'string'
    ? { chat: x.origin.chat, at: Number(x.origin.at) || 0 } : null;
  // Versions up to 0.4 stored chosen recipients; the open chat is the recipient now.
  return {
    v: DRAFT_VERSION,
    id: String(x.id || uid()),
    question: String(x.question || ''),
    options,
    multiple: !!x.multiple,
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
// The chat open in WhatsApp Web: where the next poll goes.
let active = { chat: null, error: '' };
const blankChatPolls = () => ({ loading: false, error: '', chat: '', chatId: '', polls: null });
let chatPolls = blankChatPolls();
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
    .catch(() => toast(t("Non riesco a salvare le bozze.")));
}

function problems(d) {
  const p = [];
  if (!d.question.trim()) p.push(t("Scrivi la domanda."));
  const opts = cleanOptions(d);
  if (opts.length < 2) p.push(t("Servono almeno due opzioni."));
  if (opts.length > MAX_OPTIONS) p.push(t("Al massimo {0} opzioni.", MAX_OPTIONS));
  const seen = new Set();
  if (opts.some((o) => { const k = o.toLocaleLowerCase(locale); if (seen.has(k)) return true; seen.add(k); return false; })) {
    p.push(t("Due opzioni sono uguali: WhatsApp le vuole tutte diverse."));
  }
  return p;
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
  if (!tab) throw new WaError(t("Apri WhatsApp Web in una scheda."), 'notab');
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'wa', cmd, args });
  } catch {
    throw new WaError(t("La scheda di WhatsApp Web va ricaricata."), tab.status === 'loading' ? 'loading' : 'noscript');
  }
  if (!res) throw new WaError(t("La scheda di WhatsApp Web va ricaricata."), 'noscript');
  if (!res.ok) throw new WaError(t(res.error) || t("WhatsApp Web ha rifiutato la richiesta."), 'wa');
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
  const chatBefore = active.chat?.id || '';
  try {
    const s = await call('state');
    wa.me = s.me || '';
    wa.state = !s.ready ? 'loading' : !s.authenticated ? 'login' : !s.mainReady ? 'syncing' : 'online';
  } catch (e) {
    wa.state = e.code === 'notab' || e.code === 'noscript' ? e.code : 'loading';
  }
  if (wa.state === 'loading') wa.loadingSince ||= Date.now();
  else wa.loadingSince = 0;

  if (wa.state === 'online') {
    try { active = { chat: await call('activeChat'), error: '' }; } catch (e) { active = { chat: null, error: t(e.message) }; }
  } else {
    active = { chat: null, error: '' };
  }
  const chatChanged = (active.chat?.id || '') !== chatBefore;

  if (wa.state !== before || chatChanged) {
    if (view === 'edit') renderSend();
    if (view === 'import') {
      const stale = (active.chat?.id || '') !== chatPolls.chatId || chatPolls.polls === null;
      if (wa.state === 'online' && stale) loadChatPolls();
      else renderImport();
    }
  }
  renderStatus();
  refreshing = false;
  if (refreshAgain) { refreshAgain = false; refresh(); return; }
  refreshTimer = setTimeout(refresh, wa.state === 'online' ? 30000 : 3000);
}

function statusInfo() {
  switch (wa.state) {
    case 'notab':
      return ['err', t("WhatsApp Web non è aperto"), t("Apri"), openWa, ''];
    case 'noscript':
      return ['err', t("WhatsApp Web va ricaricato"), t("Ricarica"), reloadWa, t("La scheda era aperta da prima dell'estensione: basta ricaricarla una volta.")];
    case 'loading': {
      const slow = wa.loadingSince && Date.now() - wa.loadingSince > SLOW_LOAD_MS;
      return ['wait', t("WhatsApp Web si sta caricando…"), slow ? t("Ricarica") : '', slow ? reloadWa : null,
        slow ? t("Ci sta mettendo troppo. Se resta così anche dopo aver ricaricato, WA-JS non funziona con questa versione di WhatsApp Web e va aggiornato.") : ''];
    }
    case 'login':
      return ['wait', t("WhatsApp non è collegato"), t("Mostra il QR"), openWa, t("Inquadra il QR nella scheda di WhatsApp Web con il telefono.")];
    case 'syncing':
      return ['wait', t("Sincronizzo le chat…"), '', null, ''];
    case 'online':
      return ['online', t("Collegato") + (wa.me ? t(" come +") + wa.me.split('@')[0].split(':')[0] : ''), '', null, ''];
    default:
      return ['', t("Controllo WhatsApp Web…"), '', null, ''];
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

async function loadChatPolls() {
  if (chatPolls.loading) return;
  chatPolls.loading = true;
  chatPolls.error = '';
  renderImport();
  try {
    const res = await call('chatPolls');
    chatPolls.chat = res.chat;
    chatPolls.chatId = res.chatId || '';
    chatPolls.polls = res.polls;
  } catch (e) {
    chatPolls.error = t(e.message);
    chatPolls.chatId = active.chat?.id || '';
    chatPolls.polls = null;
  } finally {
    chatPolls.loading = false;
  }
  renderImport();
}

async function send(d) {
  const target = active.chat;
  if (!target || target.reason || sending) return;
  sending = true;
  closeEmoji();
  renderSend();
  const question = d.question.trim();
  const choices = cleanOptions(d);
  const multiple = d.multiple;
  let entry;
  try {
    // WhatsApp reads 0 as "any number of answers".
    const out = await call('sendPoll', { chatId: target.id, name: question, choices, selectableCount: multiple ? 0 : 1 });
    if (out && out.sent === false) {
      // The page found another chat open, or one that takes no messages: nothing went out.
      sending = false;
      active = { chat: out.active || null, error: '' };
      renderSend();
      toast(!out.active ? t("Nessuna chat aperta in WhatsApp Web: non ho mandato niente.")
        : out.active.id !== target.id ? t("La chat aperta è cambiata: ora è «{0}». Non ho mandato niente.", out.active.name)
        : t(out.active.reason));
      return;
    }
    entry = { ok: true, info: out?.id || '' };
  } catch (e) {
    entry = { ok: false, info: t(e.message) };
  }
  d.sends.push({ jid: target.id, label: target.name, at: Date.now(), question, choices, multiple, ...entry });
  sending = false;
  d.updatedAt = Date.now();
  save();
  if (view === 'edit' && currentId === d.id) renderView();
  toast(entry.ok ? t("Inviato a {0}.", target.name) : t("Non è partito: {0}", entry.info));
  refresh();
}

// ---- drafts ----

function touch(d) {
  d.updatedAt = Date.now();
  save();
  renderPreview();
  renderSend();
  renderLog();
  const s = document.getElementById('saved');
  if (s) s.textContent = t("Salvato alle ") + time(d.updatedAt);
}

function go(next, id = currentId) {
  currentId = id;
  view = next;
  save();
  renderView();
  window.scrollTo(0, 0);
}

const select = (id) => go(id ? 'edit' : 'list', id);
const back = () => go('list');

function openImport() {
  chatPolls = blankChatPolls();
  go('import');
  if (wa.state === 'online') loadChatPolls();
}

function newDraft(from) {
  const d = normalizeDraft({ id: uid(), ...from });
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
  toast(t("Bozza creata dal sondaggio della chat."));
}

function duplicate(src) {
  const d = normalizeDraft({ ...structuredClone(src), id: uid(), sends: [], createdAt: Date.now(), updatedAt: Date.now() });
  drafts.push(d);
  select(d.id);
  toast(t("Copia creata."));
}

function remove(d) {
  if (!deleteArmed) {
    deleteArmed = true;
    document.getElementById('btnDelete').textContent = t("Confermi?");
    setTimeout(() => {
      deleteArmed = false;
      const b = document.getElementById('btnDelete');
      if (b) b.textContent = t("Elimina");
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
  if (d.options.length >= MAX_OPTIONS) { toast(t("WhatsApp accetta al massimo {0} opzioni.", MAX_OPTIONS)); return; }
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
      type: 'button', class: 'emoji-btn', title: 'Emoji', 'aria-label': t("Inserisci un'emoji"),
      onclick: (e) => { e.stopPropagation(); toggleEmoji(field, popAfter ? popAfter() : field.parentElement); },
    }, smiley()));
}

function toggleEmoji(field, after) {
  if (emojiTarget === field) { closeEmoji(true); return; }
  closeEmoji();
  if (!picker) {
    if (!window.createEmojiPicker) { toast(t("Le emoji si stanno ancora caricando, riprova tra un attimo.")); return; }
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
    h('h2', {}, t("Prima di cominciare")),
    h('ul', {},
      h('li', {}, t("Sondaggi in bozza è un progetto indipendente: non è di WhatsApp né di Meta e non è affiliato a loro.")),
      h('li', {}, t("Serve a preparare e tenere in ordine i sondaggi. I sondaggi e il registro degli invii restano in questo browser: non vanno a nessun server.")),
      h('li', {}, t("Un sondaggio parte solo verso la chat aperta in WhatsApp Web, quando premi il tasto che ne mostra il nome. Una chat alla volta.")),
      h('li', {}, t("Mandalo solo a chi ti conosce e se lo aspetta. WhatsApp può limitare o bloccare gli account che inviano messaggi non richiesti."))),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn',
        onclick: () => {
          noticeAck = true;
          chrome.storage.local.set({ noticeAck: NOTICE_VERSION }).catch(() => {});
          renderView();
        },
      }, t("Ho capito")),
      h('a', { class: 'btn ghost', href: REPO_URL + '/blob/main/PRIVACY.md', target: '_blank', rel: 'noopener' }, 'Privacy')));
}

function footer() {
  return h('p', { class: 'foot' },
    t("Progetto indipendente, non affiliato a WhatsApp né a Meta. "),
    h('a', { href: REPO_URL + '/blob/main/PRIVACY.md', target: '_blank', rel: 'noopener' }, 'Privacy'),
    ' · ',
    h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, t("Codice sorgente")));
}

function renderView() {
  closeEmoji();
  deleteArmed = false;
  if (!noticeAck) { $('#view').replaceChildren(noticeView()); return; }
  if (view === 'edit' && !current()) view = 'list';
  const screens = { edit: () => editView(current()), import: importView, list: listView };
  $('#view').replaceChildren((screens[view] || listView)());
  if (view === 'edit') {
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
      h('h2', {}, t("Sondaggi")),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: openImport, title: t("Crea una bozza da un sondaggio della chat aperta in WhatsApp Web") }, t("Da una chat")),
        h('button', { class: 'btn small', onclick: () => newDraft() }, t("Nuovo")))),
    items.length
      ? h('ul', { class: 'drafts' }, items.map((d) => {
          const reached = sentTo(d).size;
          return h('li', {}, h('button', { class: 'draft', onclick: () => select(d.id) },
            h('span', { class: 'dq' }, d.question.trim() || t("Senza domanda")),
            h('span', { class: 'dm' },
              t("{0} opzioni · ", cleanOptions(d).length) + (reached ? t("inviato in {0} chat", reached) : t("mai inviato")))));
        }))
      : h('div', { class: 'empty' },
          h('p', {}, t("Ancora nessun sondaggio.")),
          h('p', { class: 'note' }, t("Preparane uno con Nuovo, o prendi un sondaggio che c'è già in una chat con Da una chat."))),
    h('div', { class: 'list-foot' },
      h('button', { class: 'btn ghost small', onclick: exportDrafts, disabled: !drafts.length }, t("Esporta file")),
      h('button', { class: 'btn ghost small', onclick: () => $('#importFile').click() }, t("Importa file"))),
    footer());
}

function importView() {
  return h('div', {},
    h('div', { class: 'ed-head' },
      h('button', { class: 'back', onclick: back }, t("‹ Sondaggi")),
      h('span', { class: 'saved' }),
      h('button', { class: 'btn ghost small', id: 'btnChatPolls', onclick: loadChatPolls }, t("Aggiorna"))),
    h('div', { class: 'card' },
      h('h2', {}, t("Da una chat")),
      h('p', { class: 'note', style: 'margin:0 0 12px' },
        t("Apri in WhatsApp Web la chat con il sondaggio, poi scegli quale trasformare in bozza. Il sondaggio in chat resta com'è.")),
      h('div', { id: 'chatPolls' })));
}

function renderImport() {
  const box = document.getElementById('chatPolls');
  if (!box) return;
  const btn = document.getElementById('btnChatPolls');
  if (btn) btn.disabled = chatPolls.loading || wa.state !== 'online';
  const say = (t) => box.replaceChildren(h('p', { class: 'note pad' }, t));
  if (wa.state !== 'online') return say(statusInfo()[1] + '.');
  if (chatPolls.loading) return say(t("Cerco i sondaggi nella chat aperta…"));
  if (chatPolls.error) return say(chatPolls.error);
  if (chatPolls.polls === null) return say(t("Premi Aggiorna per cercare i sondaggi nella chat aperta."));
  if (!chatPolls.polls.length) {
    return say(t("Nella chat «{0}» non trovo sondaggi. Se è più indietro, scorri la chat in WhatsApp Web fino a vederlo e premi Aggiorna.", chatPolls.chat));
  }
  box.replaceChildren(
    h('p', { class: 'f' }, t("Chat «{0}»", chatPolls.chat)),
    h('ul', { class: 'chat-polls' }, chatPolls.polls.map((p) => {
      const known = drafts.some((d) => samePoll(d, p));
      return h('li', {},
        h('div', { class: 'cp-q' }, p.question),
        h('div', { class: 'cp-o' }, p.options.join(' · ')),
        h('div', { class: 'cp-foot' },
          h('span', { class: 'lmeta' }, [
            p.multiple ? t("più risposte") : t("una risposta"),
            p.at && when(p.at),
            p.fromMe ? t("tuo") : p.author && t("di ") + p.author,
          ].filter(Boolean).join(' · ')),
          known && h('span', { class: 'tag soft' }, t("già fra le bozze")),
          h('button', { class: 'btn small', onclick: () => importPoll(p) }, t("Crea bozza"))));
    })));
}

function editView(d) {
  const opts = h('div', { id: 'opts' });
  d.options.forEach((o, i) => {
    const input = h('input', {
      type: 'text', value: o, 'data-i': i,
      placeholder: t("Opzione {0}", i + 1), 'aria-label': t("Opzione {0}", i + 1),
      oninput: (e) => { d.options[i] = e.target.value; touch(d); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(d, i + 1); } },
    });
    const row = h('div', { class: 'opt' },
      h('span', { class: 'opt-n' }, i + 1),
      withEmoji(input, () => row),
      h('button', { class: 'icon', title: t("Sposta su"), 'aria-label': t("Sposta su"), disabled: i === 0, onclick: () => moveOption(d, i, -1) }, '↑'),
      h('button', { class: 'icon', title: t("Sposta giù"), 'aria-label': t("Sposta giù"), disabled: i === d.options.length - 1, onclick: () => moveOption(d, i, 1) }, '↓'),
      h('button', { class: 'icon', title: t("Togli"), 'aria-label': t("Togli opzione"), disabled: d.options.length <= 2, onclick: () => removeOption(d, i) }, '×'));
    opts.append(row);
  });

  const radio = (val, text) => h('label', {},
    h('input', { type: 'radio', name: 'multi', checked: d.multiple === val, onchange: () => { d.multiple = val; touch(d); } }),
    text);

  return h('div', {},
    h('div', { class: 'ed-head' },
      h('button', { class: 'back', onclick: back }, t("‹ Sondaggi")),
      h('span', { class: 'saved', id: 'saved' }, t("Salvato alle ") + time(d.updatedAt)),
      h('button', { class: 'btn ghost small', onclick: () => duplicate(d) }, t("Duplica")),
      h('button', { class: 'btn danger small', id: 'btnDelete', onclick: () => remove(d) }, t("Elimina"))),

    d.origin && h('p', { class: 'note', style: 'margin:0 0 10px' },
      t("Preso dalla chat «{0}»", d.origin.chat) + (d.origin.at ? t(", dove era stato mandato {0}.", when(d.origin.at)) : '.')),

    d.sends.some((s) => s.ok) && h('div', { class: 'infobar' },
      t("Su WhatsApp un sondaggio inviato non si può più modificare. Le modifiche che fai qui valgono per i prossimi invii.")),

    h('div', { class: 'card' },
      h('div', { class: 'field' },
        h('label', { class: 'f', for: 'q' }, t("Domanda")),
        withEmoji(h('textarea', {
          id: 'q', class: 'q', rows: 2,
          placeholder: t("Es. Quando ci vediamo per la cena?"),
          oninput: (e) => { d.question = e.target.value; touch(d); },
        }, d.question))),
      h('div', { class: 'field' },
        h('div', { class: 'f' }, t("Opzioni")),
        opts,
        h('button', { class: 'btn ghost small', disabled: d.options.length >= MAX_OPTIONS, onclick: () => addOption(d, d.options.length) }, t("+ Aggiungi opzione")),
        h('p', { class: 'note' }, t("Da 2 a {0}, tutte diverse. Invio su un'opzione ne aggiunge una sotto.", MAX_OPTIONS))),
      h('div', { class: 'field' },
        h('div', { class: 'f' }, t("Risposte")),
        h('div', { class: 'radio' }, radio(false, t("Una sola")), radio(true, t("Più di una"))))),

    // The preview and the button that names the open chat are the confirmation:
    // what goes out and where, both on screen before the click.
    h('div', { class: 'card' },
      h('h2', {}, t("Anteprima")),
      h('div', { id: 'preview', class: 'chatbg' }),
      h('div', { id: 'sendBox', class: 'send-box' })),

    h('div', { class: 'card', id: 'logCard', hidden: true },
      h('div', { class: 'h2row' }, h('h2', {}, t("Invii")), h('span', { id: 'logCount' })),
      h('div', { id: 'log' })));
}

function renderPreview() {
  const box = document.getElementById('preview');
  const d = current();
  if (!box || !d) return;
  const opts = cleanOptions(d);
  box.replaceChildren(h('div', { class: 'bubble' },
    h('div', { class: 'pq' }, d.question.trim() || t("La tua domanda")),
    h('div', { class: 'phint' }, d.multiple ? t("Seleziona una o più opzioni") : t("Seleziona un'opzione")),
    (opts.length ? opts : [t("Opzione 1"), t("Opzione 2")]).map((o) => h('div', { class: 'popt' }, h('span', { class: d.multiple ? 'mark sq' : 'mark' }), o)),
    h('div', { class: 'pfoot' }, t("Visualizza voti"))));
}

function renderSend() {
  const box = document.getElementById('sendBox');
  const d = current();
  if (!box || !d) return;
  box.replaceChildren();
  const probs = problems(d);
  const chat = active.chat;
  const say = (t, cls = 'note') => box.append(h('p', { class: cls }, t));
  if (probs.length) box.append(h('ul', { class: 'probs' }, probs.map((p) => h('li', {}, p))));

  let reason = '';
  if (wa.state !== 'online') reason = statusInfo()[1] + '.';
  else if (active.error) reason = active.error;
  else if (!chat) reason = t("Apri in WhatsApp Web la chat dove vuoi mandarlo: il tasto qui sotto prende il suo nome.");
  else if (chat.reason) reason = t(chat.reason);
  if (reason) say(reason);

  const last = chat && [...d.sends].reverse().find((s) => s.ok && s.jid === chat.id);
  if (chat && !chat.reason && last) say(t("«{0}» l'ha già ricevuto {1}: gli arriverà di nuovo.", chat.name, when(last.at)));

  const can = !probs.length && chat && !chat.reason && !reason && !sending;
  box.append(h('button', {
    class: 'btn send', id: 'btnSend', disabled: !can,
    title: chat ? t("Manda il sondaggio nella chat «{0}» aperta in WhatsApp Web", chat.name) : '',
    onclick: () => send(d),
  }, sending ? t("Invio in corso…") : chat ? t("Invia a {0}", chat.name) : t("Invia")));
  if (chat && !chat.reason) say(chat.isGroup ? t("Gruppo aperto in WhatsApp Web.") : t("Chat aperta in WhatsApp Web."), 'note send-hint');
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
    ok && `${ok} ${ok === 1 ? t("riuscito") : t("riusciti")}`,
    ko && t(ko === 1 ? "{0} non riuscito" : "{0} non riusciti", ko),
  ].filter(Boolean).join(' · ');
  box.replaceChildren(h('ul', { class: 'log' }, [...d.sends].sort((a, b) => b.at - a.at).map((s) => h('li', {},
    h('div', { class: 'lrow' },
      h('span', { class: 'lname', title: s.jid }, s.label),
      h('span', { class: s.ok ? 'ok' : 'ko' }, s.ok ? t("inviato") : t("non riuscito"))),
    h('div', { class: 'lmeta' }, when(s.at), !s.ok && s.info && ' · ' + t(s.info)),
    s.question !== null && !sameVersion(s, d) && h('div', { class: 'lmeta' }, t("Versione precedente: «{0}»", s.question))))));
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
    toast(t("{0} sondaggi importati.", n));
  } catch {
    toast(t("Il file non è un export di questa estensione."));
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
