// Drives the side panel in headless Chrome against a fake WhatsApp Web (tests/fixtures/chrome-stub.js).
// Run: node tests/panel.test.mjs   (CHROME_BIN overrides the browser; SHOTS_DIR saves screenshots)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBin, connect, launch, newTab, reporter, sleep } from './lib/cdp.mjs';
import { serve } from './lib/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS_DIR;
const port = 9400 + Math.floor(Math.random() * 400);
const { check, done } = reporter();
const server = await serve(ROOT);
const proc = await launch({ bin: chromeBin(), port });
const PANEL = server.url + '/panel.html';

const helpers = `
  window.T = {
    q: (s) => document.querySelector(s),
    qa: (s) => [...document.querySelectorAll(s)],
    byText: (sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === t),
    set: (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
    enter: (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    item: (name) => [...document.querySelectorAll('#pickList label')].find((l) => l.querySelector('.iname span').textContent === name),
    pickItem: (name) => T.item(name).querySelector('input').click(),
    names: () => [...document.querySelectorAll('#pickList .iname > span')].map((s) => s.textContent).join('|'),
    chips: () => [...document.querySelectorAll('#chips .chip > span')].map((s) => s.textContent).join('|'),
    pick: () => document.querySelector('emoji-picker').shadowRoot,
    sendText: () => document.querySelector('#sendBox').innerText,
    sendButton: () => document.querySelector('#sendBox > button'),
  }; true`;

async function waitFor(c, expr, ms = 10000) {
  for (let t = 0; t < ms; t += 200) {
    if (await c.ev(expr).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}

const shot = async (c, name) => { if (SHOTS) await c.shot(join(SHOTS, name)); };

async function sendNow(c) {
  await c.ev(`T.sendButton().click(); true`);
  await c.ev(`T.byText('button', 'Sì, invia').click(); true`);
  await waitFor(c, `!T.sendText().includes('Invio in corso')`, 5000);
  await sleep(200);
}

try {
  const tab = await newTab(port);
  const c = await connect(tab.webSocketDebuggerUrl);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 2, mobile: false });
  // Without it a headless page never gets focus events, and the caret position is unknown.
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.goto(PANEL);
  await c.ev(helpers);

  // First run: the notice comes before anything else.
  const notice = await c.ev(`T.q('.notice')?.innerText || ''`);
  check('notice shown on first run', notice.includes('non è di WhatsApp né di Meta') && notice.includes('una persona o un gruppo alla volta'), notice);
  await shot(c, 'notice.png');
  await c.ev(`T.byText('button', 'Ho capito').click(); true`);
  check('notice remembered', (await c.ev(`__mock.store().noticeAck`)) === 2);
  check('list after notice', (await c.ev(`T.q('#view').innerText`)).includes('Ancora nessun sondaggio'));
  check('footer links privacy and source', await c.ev(`T.qa('.foot a').map((a) => a.href).join(' ').includes('/blob/main/PRIVACY.md')`));
  check('status online', (await c.ev(`T.q('#pill').textContent`)).startsWith('Collegato come +393330000000'));

  // Editing.
  await c.ev(`T.byText('button', 'Nuovo').click(); true`);
  await sleep(200);
  check('new draft focuses the question', await c.ev(`document.activeElement === T.q('#q')`));
  await c.ev(`T.set(T.q('#q'), 'Cena venerdì?');
    T.set(T.q('#opts input[data-i="0"]'), 'Pizzeria');
    T.set(T.q('#opts input[data-i="1"]'), 'Sushi'); true`);
  await c.ev(`T.byText('button', '+ Aggiungi opzione').click(); true`);
  await c.ev(`T.set(T.q('#opts input[data-i="2"]'), 'pizzeria'); true`);
  check('duplicate options flagged', (await c.ev(`T.sendText()`)).includes('Due opzioni sono uguali'));
  await c.ev(`T.set(T.q('#opts input[data-i="2"]'), 'Trattoria'); true`);
  await c.ev(`T.enter(T.q('#opts input[data-i="2"]')); true`);
  check('enter adds an option', (await c.ev(`T.qa('#opts .opt').length`)) === 4);
  await c.ev(`T.qa('#opts .opt')[3].querySelector('[aria-label="Togli opzione"]').click(); true`);
  await c.ev(`T.qa('#opts .opt')[0].querySelector('[aria-label="Sposta giù"]').click(); true`);
  check('options reorder', (await c.ev(`T.qa('#opts input').map((i) => i.value).join(',')`)) === 'Sushi,Pizzeria,Trattoria');
  await c.ev(`T.qa('#opts .opt')[0].querySelector('[aria-label="Sposta giù"]').click(); true`);

  // Emoji: Italian search, inserted at the caret, picker under the field it belongs to.
  await c.ev(`const q = T.q('#q'); q.focus(); q.setSelectionRange(4, 4); q.parentElement.querySelector('.emoji-btn').click(); true`);
  check('picker opens under the question', await waitFor(c, `!!T.q('.emoji-pop emoji-picker')?.shadowRoot?.querySelector('#search')`));
  await c.ev(`(() => { const s = T.pick().querySelector('#search'); s.value = 'pizza'; s.dispatchEvent(new Event('input', { bubbles: true, composed: true })); })(); true`);
  check('italian search finds pizza', await waitFor(c, `/pizza/i.test(T.pick().querySelector('.emoji-menu [role=option]')?.getAttribute('aria-label') || '')`));
  await shot(c, 'emoji.png');
  await c.ev(`T.pick().querySelector('.emoji-menu [role=option]').click(); true`);
  await c.ev(`T.pick().querySelector('.emoji-menu [role=option]').click(); true`);
  // The picker dispatches emoji-click after an async lookup, so wait for both insertions.
  check('emoji inserted at the caret', await waitFor(c, `T.q('#q').value === 'Cena🍕🍕 venerdì?'`, 3000), await c.ev(`T.q('#q').value`));
  await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  check('escape closes the picker', await c.ev(`!T.q('.emoji-pop')`));
  await c.ev(`T.qa('#opts .opt')[1].querySelector('.emoji-btn').click(); true`);
  check('picker opens under an option', await waitFor(c, `T.q('.emoji-pop')?.previousElementSibling === T.qa('#opts .opt')[1]`));
  await c.ev(`T.q('#view h2').click(); true`);
  check('outside click closes the picker', await c.ev(`!T.q('.emoji-pop')`));

  // One recipient: picking another replaces it, across groups, contacts and typed numbers.
  check('groups listed', await waitFor(c, `T.names() === 'Calcetto del giovedì|Capodanno 2027|Famiglia'`));
  check('nothing to send without a recipient', await c.ev(`T.sendButton().disabled && T.sendText().includes('Nessun destinatario scelto')`));
  await c.ev(`T.pickItem('Famiglia'); true`);
  check('a group becomes the recipient', (await c.ev(`T.chips()`)) === 'Famiglia');
  await c.ev(`T.pickItem('Calcetto del giovedì'); true`);
  check('picking another replaces it', (await c.ev(`T.chips()`)) === 'Calcetto del giovedì' && (await c.ev(`T.qa('#pickList input:checked').length`)) === 1);
  await c.ev(`T.byText('.tab', 'Contatti').click(); true`);
  check('contacts listed', await waitFor(c, `T.names() === 'Giulia Bianchi|Mario Rossi|Zoë'`));
  await c.ev(`T.set(T.q('#picker input[type=search]'), 'zoe'); true`);
  check('search ignores accents', (await c.ev(`T.names()`)) === 'Zoë');
  await c.ev(`T.set(T.q('#picker input[type=search]'), '765'); true`);
  check('search by number', (await c.ev(`T.names()`)) === 'Giulia Bianchi');
  await c.ev(`T.set(T.q('#picker input[type=search]'), '393331112222'); true`);
  check('a known number shows the contact only', (await c.ev(`T.names()`)) === 'Mario Rossi' && (await c.ev(`!T.q('.addnum')`)));
  await c.ev(`T.pickItem('Mario Rossi'); true`);
  check('a contact replaces the group', (await c.ev(`T.chips()`)) === 'Mario Rossi');
  await c.ev(`T.set(T.q('#picker input[type=search]'), '+39 345 000 1111'); true`);
  check('a new number is offered', (await c.ev(`T.q('.addnum')?.textContent`)) === '+ Usa il numero +393450001111');
  await c.ev(`T.enter(T.q('#picker input[type=search]')); true`);
  check('a typed number replaces the contact', (await c.ev(`T.chips()`)) === '+393450001111' && (await c.ev(`T.q('#picker input[type=search]').value`)) === '');
  await shot(c, 'editor.png');

  // Confirmation names the content and the recipient; a typed number is called out.
  await c.ev(`T.sendButton().click(); true`);
  const confirmText = await c.ev(`T.sendText()`);
  check('confirm shows question and recipient', confirmText.includes('«Cena🍕🍕 venerdì?» (3 opzioni, una risposta) a +393450001111 (numero scritto a mano).'), confirmText);
  check('confirm warns about a typed number', confirmText.includes('anche se non ti conosce'));
  await shot(c, 'confirm.png');
  await c.ev(`T.byText('button', 'Sì, invia').click(); true`);
  await waitFor(c, `!T.sendText().includes('Invio in corso')`, 5000);
  const sent = JSON.parse(await c.ev(`JSON.stringify(__mock.sent)`));
  check('one poll sent', sent.length === 1);
  check('payload', sent[0].chatId === '393450001111@c.us' && sent[0].name === 'Cena🍕🍕 venerdì?' && sent[0].choices.join() === 'Pizzeria,Sushi,Trattoria' && sent[0].selectableCount === 1, JSON.stringify(sent[0]));
  check('recipient cleared after sending', (await c.ev(`T.chips()`)) === '' && (await c.ev(`T.sendButton().disabled`)));
  check('poll stays editable', await c.ev(`!T.q('#q').disabled`));
  check('notice about editing after sending', (await c.ev(`T.q('.infobar')?.textContent || ''`)).includes('valgono per i prossimi invii'));

  // A failed send keeps the recipient, so pressing Invia again retries.
  await c.ev(`T.byText('.tab', 'Gruppi').click(); true`);
  await sleep(200);
  await c.ev(`T.pickItem('Calcetto del giovedì'); true`);
  await sendNow(c);
  check('failed recipient stays chosen', (await c.ev(`T.chips()`)) === 'Calcetto del giovedì' && (await c.ev(`T.sendButton().textContent`)) === 'Invia a Calcetto del giovedì');
  await c.ev(`__mock.failFor.clear(); true`);
  await sendNow(c);
  check('retry succeeds and clears', (await c.ev(`__mock.sent.length`)) === 3 && (await c.ev(`T.chips()`)) === '');

  // The log, the previous version, and a repeat recipient.
  const logText = await c.ev(`T.q('#logCard').innerText`);
  check('send log at the bottom', await c.ev(`T.q('#view > div').lastElementChild.id === 'logCard'`) && logText.includes('2 riusciti · 1 non riuscito') && logText.includes('Non puoi scrivere in questo gruppo.'), logText);
  await c.ev(`T.set(T.q('#q'), 'Cena sabato?'); true`);
  check('older sends marked as previous version', (await c.ev(`T.q('#logCard').innerText`)).includes('Versione precedente: «Cena🍕🍕 venerdì?»'));
  await c.ev(`T.pickItem('Calcetto del giovedì'); true`);
  check('chip says already sent', (await c.ev(`T.q('#chips').innerText`)).includes('già inviato'));
  check('list marks who already has it', (await c.ev(`T.item('Calcetto del giovedì').innerText`)).includes('inviato'));
  await c.ev(`T.sendButton().click(); true`);
  check('confirm warns about a repeat', (await c.ev(`T.sendText()`)).includes("L'ha già ricevuto: gli arriverà di nuovo."));
  await c.ev(`T.byText('button', 'Sì, invia').click(); true`);
  await waitFor(c, `!T.sendText().includes('Invio in corso')`, 5000);
  check('resend uses the new text', (await c.ev(`__mock.sent.length`)) === 4 && (await c.ev(`__mock.sent[3].name`)) === 'Cena sabato?');
  await shot(c, 'sent.png');

  // Contacts failing to load: the error shows, typing a number still works.
  await c.ev(`__mock.contactsError = 'ContactStore non disponibile'; T.byText('.tab', 'Contatti').click(); true`);
  await c.ev(`T.byText('#picker button', 'Aggiorna').click(); true`);
  check('contact error shown with a way out', await waitFor(c, `T.q('#pickList').innerText.includes('ContactStore non disponibile. Puoi comunque scrivere un numero')`, 3000));
  await c.ev(`T.set(T.q('#picker input[type=search]'), '00393401234567'); true`);
  check('number offered despite the error', !!(await c.ev(`T.q('.addnum')`)));

  await c.ev(`T.byText('button', '‹ Sondaggi').click(); true`);
  await sleep(200);
  check('list summary', (await c.ev(`T.q('.draft .dm').textContent`)) === '3 opzioni · inviato a 2', await c.ev(`T.q('.draft .dm').textContent`));

  // A poll already in the open chat becomes a new draft.
  await c.ev(`T.byText('button', 'Da una chat').click(); true`);
  check('chat polls listed', await waitFor(c, `T.qa('.chat-polls li').length === 2`, 3000));
  const cp = await c.ev(`T.q('#chatPolls').innerText`);
  check('chat polls show chat, author and type', cp.includes('Chat «Famiglia»') && cp.includes('di Mamma') && cp.includes('più risposte') && cp.includes('tuo'), cp);
  check('a poll that is not a draft is not marked', !(await c.ev(`T.q('#chatPolls').innerText`)).includes('già fra le bozze'));
  await shot(c, 'import.png');
  await c.ev(`T.qa('.chat-polls li')[0].querySelector('button').click(); true`);
  await sleep(300);
  check('imported poll opens as a draft', (await c.ev(`T.q('#q').value`)) === 'Pranzo di domenica: chi porta cosa?'
    && (await c.ev(`T.qa('#opts input').map((i) => i.value).join(',')`)) === 'Dolce,Vino,Pane'
    && (await c.ev(`T.qa('input[name=multi]')[1].checked`)));
  check('imported draft says where it came from', (await c.ev(`T.q('#view').innerText`)).includes('Preso dalla chat «Famiglia»'));
  check('imported draft has no recipient or log', (await c.ev(`T.chips()`)) === '' && (await c.ev(`T.q('#logCard').hidden`)));
  await c.ev(`T.byText('button', '‹ Sondaggi').click(); T.byText('button', 'Da una chat').click(); true`);
  check('imported poll now marked as known', await waitFor(c, `(T.qa('.chat-polls li')[0]?.innerText || '').includes('già fra le bozze')`, 3000));
  await c.ev(`__mock.chatPollsError = 'Apri in WhatsApp Web la chat con il sondaggio, poi premi Aggiorna.'; T.byText('button', 'Aggiorna').click(); true`);
  check('no open chat explained', await waitFor(c, `T.q('#chatPolls').innerText.includes('Apri in WhatsApp Web la chat con il sondaggio')`, 3000));

  await c.ev(`T.byText('button', '‹ Sondaggi').click(); true`);
  await sleep(200);
  await c.ev(`T.qa('.draft').find((b) => b.innerText.includes('Cena sabato?')).click(); true`);
  await sleep(200);
  await c.ev(`T.byText('button', 'Duplica').click(); true`);
  await sleep(200);
  check('duplicate starts with no log', await c.ev(`T.q('#logCard').hidden && !T.q('.infobar') && T.q('#q').value === 'Cena sabato?'`));

  const errors = c.logs.filter((l) => !l.includes('ETag'));
  check('no page errors', errors.length === 0, errors.join(' ; '));

  // Older drafts: 0.1 kept served recipients in a list, 0.2 kept only pending ones.
  await c.ev(`sessionStorage.setItem('seed', JSON.stringify({ noticeAck: 1, view: 'list', drafts: [
    { id: 'v1', question: 'Vecchio', options: ['A', 'B'], multiple: false, createdAt: 1, updatedAt: 3,
      recipients: [{ jid: '120363000001@g.us', label: 'Famiglia' }, { jid: '120363000003@g.us', label: 'Capodanno 2027' }],
      sends: [{ jid: '120363000001@g.us', label: 'Famiglia', ok: true, info: 'x', at: Date.now() - 86400000 }] },
    { v: 2, id: 'v2', question: 'Medio', options: ['A', 'B'], multiple: false, createdAt: 1, updatedAt: 2,
      recipients: [{ jid: '393331112222@c.us', label: 'Mario Rossi', source: 'contact' }, { jid: '120363000003@g.us', label: 'Capodanno 2027', source: 'group' }], sends: [] },
  ] })); true`);
  await c.goto(PANEL);
  await c.ev(helpers);
  check('changed notice shown again to earlier users', await c.ev(`!!T.q('.notice')`));
  await c.ev(`T.byText('button', 'Ho capito').click(); true`);
  const meta = await c.ev(`T.qa('.draft .dm').map((m) => m.textContent).join(' / ')`);
  check('old drafts keep their first pending recipient', meta === '2 opzioni · inviato a 1 · pronto per Capodanno 2027 / 2 opzioni · mai inviato · pronto per Mario Rossi', meta);
  c.close();
} finally {
  proc.kill();
  server.close();
}
done();
