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

const MARIO = { id: '393331112222@c.us', name: 'Mario Rossi', isGroup: false, reason: '' };
const FAMIGLIA = { id: '120363000001@g.us', name: 'Famiglia', isGroup: true, reason: '' };
const CALCETTO = { id: '120363000002@g.us', name: 'Calcetto del giovedì', isGroup: true, reason: '' };
const ANNUNCI = { id: '120363000004@g.us', name: 'Annunci', isGroup: true, reason: 'In questa chat non puoi scrivere.' };

const helpers = `
  window.T = {
    q: (s) => document.querySelector(s),
    qa: (s) => [...document.querySelectorAll(s)],
    byText: (sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === t),
    set: (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
    enter: (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    pick: () => document.querySelector('emoji-picker').shadowRoot,
    send: () => document.querySelector('#btnSend'),
    sendText: () => document.querySelector('#sendBox').innerText,
    log: () => document.querySelector('#logCard').innerText,
    toast: () => document.querySelector('#toast').textContent,
  }; true`;

async function waitFor(c, expr, ms = 5000) {
  for (let t = 0; t < ms; t += 100) {
    if (await c.ev(expr).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}

const shot = async (c, name) => { if (SHOTS) await c.shot(join(SHOTS, name)); };
const openChat = (c, chat) => c.ev(`__mock.open(${JSON.stringify(chat)}); true`);
const sendLabel = (c) => c.ev(`T.send().textContent`);

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
  check('notice shown on first run', notice.includes('non è di WhatsApp né di Meta') && notice.includes('solo verso la chat aperta in WhatsApp Web'), notice);
  await shot(c, 'notice.png');
  await c.ev(`T.byText('button', 'Ho capito').click(); true`);
  check('notice remembered', (await c.ev(`__mock.store().noticeAck`)) === 3);
  check('list after notice', (await c.ev(`T.q('#view').innerText`)).includes('Ancora nessun sondaggio'));
  check('footer links privacy and source', await c.ev(`T.qa('.foot a').map((a) => a.href).join(' ').includes('/blob/main/PRIVACY.md')`));
  check('status online', (await c.ev(`T.q('#pill').textContent`)).startsWith('Collegato come +393330000000'));

  // Editing.
  await c.ev(`T.byText('button', 'Nuovo').click(); true`);
  await sleep(200);
  check('new draft focuses the question', await c.ev(`document.activeElement === T.q('#q')`));
  check('an empty draft cannot be sent', await c.ev(`T.send().disabled && T.sendText().includes('Scrivi la domanda')`));
  await c.ev(`T.set(T.q('#q'), 'Cena venerdì?');
    T.set(T.q('#opts input[data-i="0"]'), 'Pizzeria');
    T.set(T.q('#opts input[data-i="1"]'), 'Sushi'); true`);
  await c.ev(`T.byText('button', '+ Aggiungi opzione').click(); true`);
  await c.ev(`T.set(T.q('#opts input[data-i="2"]'), 'pizzeria'); true`);
  check('duplicate options flagged', (await c.ev(`T.sendText()`)).includes('Due opzioni sono uguali') && (await c.ev(`T.send().disabled`)));
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

  // The recipient is the chat open in WhatsApp Web, named on the button under the preview.
  check('button names the open chat', (await sendLabel(c)) === 'Invia a Famiglia' && !(await c.ev(`T.send().disabled`)));
  check('button sits under the preview', await c.ev(`T.q('#preview').nextElementSibling === T.q('#sendBox')`));
  check('hint says it is a group', (await c.ev(`T.sendText()`)).includes('Gruppo aperto in WhatsApp Web.'));
  await openChat(c, MARIO);
  check('button follows the open chat', await waitFor(c, `T.send().textContent === 'Invia a Mario Rossi'`));
  check('hint says it is a chat', (await c.ev(`T.sendText()`)).includes('Chat aperta in WhatsApp Web.'));
  check('nothing sent by switching chats', (await c.ev(`__mock.sent.length`)) === 0);
  await shot(c, 'editor.png');

  // One click sends, to that chat.
  await c.ev(`T.send().click(); true`);
  check('sending shows progress', await c.ev(`T.send().textContent === 'Invio in corso…' && T.send().disabled`));
  await waitFor(c, `T.send().textContent !== 'Invio in corso…'`);
  const sent = JSON.parse(await c.ev(`JSON.stringify(__mock.sent)`));
  check('one poll sent to the open chat', sent.length === 1 && sent[0].chatId === MARIO.id, JSON.stringify(sent));
  check('payload', sent[0].name === 'Cena🍕🍕 venerdì?' && sent[0].choices.join() === 'Pizzeria,Sushi,Trattoria' && sent[0].selectableCount === 1, JSON.stringify(sent[0]));
  check('toast names the chat', (await c.ev(`T.toast()`)) === 'Inviato a Mario Rossi.');
  check('poll stays editable', await c.ev(`!T.q('#q').disabled`));
  check('notice about editing after sending', (await c.ev(`T.q('.infobar')?.textContent || ''`)).includes('valgono per i prossimi invii'));
  check('same chat is told it already has it', (await c.ev(`T.sendText()`)).includes("«Mario Rossi» l'ha già ricevuto oggi alle"));

  // The chat changes between what the panel shows and the click: nothing goes out.
  await c.ev(`__mock.active = ${JSON.stringify(FAMIGLIA)}; true`);
  await c.ev(`T.send().click(); true`);
  check('changed chat is caught at send time', await waitFor(c, `T.send().textContent === 'Invia a Famiglia'`) && (await c.ev(`__mock.sent.length`)) === 1);
  check('and explained', (await c.ev(`T.toast()`)).includes('La chat aperta è cambiata: ora è «Famiglia». Non ho mandato niente.'));
  check('a refused send is not logged', (await c.ev(`T.log()`)).includes('1 riuscito') && !(await c.ev(`T.log()`)).includes('non riuscito'));

  // Chats that take no poll.
  await openChat(c, ANNUNCI);
  check('read-only chat disables the button', await waitFor(c, `T.send().disabled && T.send().textContent === 'Invia a Annunci'`) && (await c.ev(`T.sendText()`)).includes('In questa chat non puoi scrivere.'));
  await openChat(c, null);
  check('no open chat disables the button', await waitFor(c, `T.send().disabled && T.send().textContent === 'Invia'`) && (await c.ev(`T.sendText()`)).includes('Apri in WhatsApp Web la chat dove vuoi mandarlo'));
  await c.ev(`__mock.state = { ready: true, authenticated: false }; true`);
  await openChat(c, FAMIGLIA);
  check('logged out disables the button', await waitFor(c, `T.send().disabled && T.sendText().includes('WhatsApp non è collegato.')`));
  await c.ev(`__mock.state = { ready: true, authenticated: true, mainReady: true, me: '393330000000:5@c.us' }; true`);

  // A failed send is logged and can be retried.
  await c.ev(`__mock.failFor.add('${CALCETTO.id}'); true`);
  await openChat(c, CALCETTO);
  await waitFor(c, `T.send().textContent === 'Invia a Calcetto del giovedì' && !T.send().disabled`);
  await c.ev(`T.send().click(); true`);
  check('failure logged with the reason', await waitFor(c, `T.log().includes('Non puoi scrivere in questo gruppo.')`) && (await c.ev(`T.toast()`)).startsWith('Non è partito'));
  await c.ev(`__mock.failFor.clear(); T.send().click(); true`);
  check('retry succeeds', await waitFor(c, `T.log().includes('2 riusciti · 1 non riuscito')`), await c.ev(`T.log()`));
  check('send log at the bottom', await c.ev(`T.q('#view > div').lastElementChild.id === 'logCard'`));

  // Editing after sending: older sends keep their text in the log.
  await c.ev(`T.set(T.q('#q'), 'Cena sabato?'); true`);
  check('older sends marked as previous version', (await c.ev(`T.log()`)).includes('Versione precedente: «Cena🍕🍕 venerdì?»'));
  await openChat(c, MARIO);
  await waitFor(c, `T.send().textContent === 'Invia a Mario Rossi'`);
  await c.ev(`T.send().click(); true`);
  check('resend uses the new text', await waitFor(c, `__mock.sent.length === 4`) && (await c.ev(`__mock.sent[3].name`)) === 'Cena sabato?');
  await shot(c, 'sent.png');

  await c.ev(`T.byText('button', '‹ Sondaggi').click(); true`);
  await sleep(200);
  check('list summary', (await c.ev(`T.q('.draft .dm').textContent`)) === '3 opzioni · inviato in 2 chat', await c.ev(`T.q('.draft .dm').textContent`));

  // A poll already in the open chat becomes a new draft.
  await openChat(c, FAMIGLIA);
  await c.ev(`T.byText('button', 'Da una chat').click(); true`);
  check('chat polls listed', await waitFor(c, `T.qa('.chat-polls li').length === 2`, 3000));
  const cp = await c.ev(`T.q('#chatPolls').innerText`);
  check('chat polls show chat, author and type', cp.includes('Chat «Famiglia»') && cp.includes('di Mamma') && cp.includes('più risposte') && cp.includes('tuo'), cp);
  check('a poll that is not a draft is not marked', !cp.includes('già fra le bozze'));
  await shot(c, 'import.png');
  await c.ev(`__mock.chatPolls = { chat: 'Calcetto del giovedì', polls: [{ id: 'p9', question: 'Campo coperto?', options: ['Sì', 'No'], multiple: false, at: Date.now(), fromMe: false, author: 'Luca' }] }; true`);
  await openChat(c, CALCETTO);
  check('switching chat reloads its polls', await waitFor(c, `T.q('#chatPolls').innerText.includes('Chat «Calcetto del giovedì»') && T.qa('.chat-polls li').length === 1`, 3000));
  await c.ev(`T.qa('.chat-polls li')[0].querySelector('button').click(); true`);
  await sleep(300);
  check('imported poll opens as a draft', (await c.ev(`T.q('#q').value`)) === 'Campo coperto?'
    && (await c.ev(`T.qa('#opts input').map((i) => i.value).join(',')`)) === 'Sì,No'
    && (await c.ev(`T.qa('input[name=multi]')[0].checked`)));
  check('imported draft says where it came from', (await c.ev(`T.q('#view').innerText`)).includes('Preso dalla chat «Calcetto del giovedì»'));
  check('imported draft starts with no log', await c.ev(`T.q('#logCard').hidden`));
  check('imported draft is ready for the open chat', (await sendLabel(c)) === 'Invia a Calcetto del giovedì');
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

  // Drafts from 0.4 stored a chosen recipient: it is dropped, the rest stays.
  await c.ev(`sessionStorage.setItem('seed', JSON.stringify({ noticeAck: 2, view: 'list', drafts: [
    { v: 3, id: 'v3', question: 'Vecchio', options: ['A', 'B'], multiple: false, createdAt: 1, updatedAt: 2,
      recipient: { jid: '120363000001@g.us', label: 'Famiglia', source: 'group' },
      sends: [{ jid: '120363000001@g.us', label: 'Famiglia', ok: true, info: 'x', at: Date.now() - 86400000 }] },
  ] })); true`);
  await c.goto(PANEL);
  await c.ev(helpers);
  check('changed notice shown again to earlier users', await c.ev(`!!T.q('.notice')`));
  await c.ev(`T.byText('button', 'Ho capito').click(); true`);
  check('old draft loads without its recipient', (await c.ev(`T.q('.draft .dm').textContent`)) === '2 opzioni · inviato in 1 chat');
  c.close();
} finally {
  proc.kill();
  server.close();
}
done();
