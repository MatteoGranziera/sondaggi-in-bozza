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
    names: () => [...document.querySelectorAll('#pickList .iname > span')].map((s) => s.textContent).join('|'),
    chips: () => [...document.querySelectorAll('#chips .chip > span')].map((s) => s.textContent).join('|'),
    pick: () => document.querySelector('emoji-picker').shadowRoot,
    sendText: () => document.querySelector('#sendBox').innerText,
  }; true`;

async function waitFor(c, expr, ms = 20000) {
  for (let t = 0; t < ms; t += 200) {
    if (await c.ev(expr).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}

const shot = async (c, name) => { if (SHOTS) await c.shot(join(SHOTS, name)); };

try {
  const tab = await newTab(port);
  const c = await connect(tab.webSocketDebuggerUrl);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 2, mobile: false });
  // Without it a headless page never gets focus events, and the caret position is unknown.
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.goto(PANEL);
  await c.ev(helpers);

  // First run: the notice comes before anything else.
  check('notice shown on first run', (await c.ev(`T.q('.notice')?.innerText || ''`)).includes('non è di WhatsApp né di Meta'));
  await shot(c, 'notice.png');
  await c.ev(`T.byText('button', 'Ho capito').click(); true`);
  check('notice remembered', (await c.ev(`__mock.store().noticeAck`)) === 1);
  check('list after notice', (await c.ev(`T.q('#view').innerText`)).includes('Ancora nessun sondaggio'));
  check('footer links privacy and source', await c.ev(`T.qa('.foot a').map((a) => a.href).join(' ').includes('/blob/main/PRIVACY.md')`));
  check('status online', (await c.ev(`T.q('#pill').textContent`)).startsWith('Collegato come +393330000000'));

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

  // Recipients: groups, contacts, and a number typed into the contact search.
  check('groups listed', await waitFor(c, `T.names() === 'Calcetto del giovedì|Capodanno 2027|Famiglia'`));
  await c.ev(`T.item('Famiglia').querySelector('input').click(); T.item('Calcetto del giovedì').querySelector('input').click(); true`);
  await c.ev(`T.byText('.tab', 'Contatti').click(); true`);
  check('contacts listed', await waitFor(c, `T.names() === 'Giulia Bianchi|Mario Rossi|Zoë'`));
  await c.ev(`T.set(T.q('#picker input[type=search]'), 'zoe'); true`);
  check('search ignores accents', (await c.ev(`T.names()`)) === 'Zoë');
  await c.ev(`T.set(T.q('#picker input[type=search]'), '765'); true`);
  check('search by number', (await c.ev(`T.names()`)) === 'Giulia Bianchi');
  await c.ev(`T.set(T.q('#picker input[type=search]'), ''); T.item('Mario Rossi').querySelector('input').click(); true`);
  await c.ev(`T.set(T.q('#picker input[type=search]'), '393331112222'); true`);
  check('a known number shows the contact only', (await c.ev(`T.names()`)) === 'Mario Rossi' && (await c.ev(`!T.q('.addnum')`)));
  await c.ev(`T.set(T.q('#picker input[type=search]'), '+39 345 000 1111'); true`);
  check('a new number can be added', (await c.ev(`T.q('.addnum')?.textContent`)) === '+ Aggiungi il numero +393450001111');
  await c.ev(`T.enter(T.q('#picker input[type=search]')); true`);
  check('four recipients across tabs', (await c.ev(`T.chips()`)) === 'Famiglia|Calcetto del giovedì|Mario Rossi|+393450001111', await c.ev(`T.chips()`));
  await c.ev(`T.byText('.tab', 'Gruppi').click(); true`);
  await shot(c, 'editor.png');

  // Confirmation names the content and every recipient.
  await c.ev(`T.byText('#sendBox button', 'Invia a 4 destinatari').click(); true`);
  const confirmText = await c.ev(`T.sendText()`);
  check('confirm shows the question', confirmText.includes('«Cena🍕🍕 venerdì?» (3 opzioni, una risposta)'), confirmText);
  check('confirm lists every recipient', (await c.ev(`T.qa('.confirm-list li span').map((s) => s.textContent).join('|')`)) === 'Famiglia|Calcetto del giovedì|Mario Rossi|+393450001111');
  check('confirm marks the typed number', confirmText.includes('numero scritto a mano') && confirmText.includes('anche se non ti conosce'));
  await shot(c, 'confirm.png');
  await c.ev(`T.byText('button', 'Sì, invia').click(); true`);
  await sleep(400);
  check('progress and stop while sending', /Invio [12] di 4/.test(await c.ev(`T.sendText()`)) && (await c.ev(`!!T.byText('#sendBox button', 'Ferma')`)));
  check('sending finishes', await waitFor(c, `!T.byText('#sendBox button', 'Ferma')`, 20000));
  const sent = JSON.parse(await c.ev(`JSON.stringify(__mock.sent)`));
  check('four polls sent', sent.length === 4);
  check('payload', sent[0].name === 'Cena🍕🍕 venerdì?' && sent[0].choices.join() === 'Pizzeria,Sushi,Trattoria' && sent[0].selectableCount === 1, JSON.stringify(sent[0]));
  check('contacts get the number address', sent[2].chatId === '393331112222@c.us');
  check('only the failed recipient stays selected', (await c.ev(`T.chips()`)) === 'Calcetto del giovedì');
  check('poll stays editable', await c.ev(`!T.q('#q').disabled`));
  check('notice about editing after sending', (await c.ev(`T.q('.infobar')?.textContent || ''`)).includes('valgono per i prossimi invii'));
  const logText = await c.ev(`T.q('#logCard').innerText`);
  check('send log at the bottom', await c.ev(`T.q('#view > div').lastElementChild.id === 'logCard'`) && logText.includes('3 riusciti · 1 non riuscito') && logText.includes('Non puoi scrivere in questo gruppo.'), logText);
  await shot(c, 'sent.png');

  // Edit and send again: the log keeps the old text, a repeat recipient is called out.
  await c.ev(`T.set(T.q('#q'), 'Cena sabato?'); true`);
  check('older sends marked as previous version', (await c.ev(`T.q('#logCard').innerText`)).includes('Versione precedente: «Cena🍕🍕 venerdì?»'));
  await c.ev(`__mock.failFor.clear(); T.item('Famiglia').querySelector('input').click(); true`);
  check('chip says already sent', (await c.ev(`T.q('#chips').innerText`)).includes('già inviato'));
  await c.ev(`T.byText('#sendBox button', 'Invia a 2 destinatari').click(); true`);
  check('confirm warns about a repeat', (await c.ev(`T.sendText()`)).includes("Uno dei destinatari l'ha già ricevuto"));
  await c.ev(`T.byText('button', 'Sì, invia').click(); true`);
  check('resend finishes', await waitFor(c, `__mock.sent.length === 6 && !T.byText('#sendBox button', 'Ferma')`, 15000));
  check('resend uses the new text', (await c.ev(`__mock.sent[5].name`)) === 'Cena sabato?');

  // Stop halfway: whoever did not get it stays selected.
  await c.ev(`['Famiglia', 'Calcetto del giovedì', 'Capodanno 2027'].forEach((n) => T.item(n).querySelector('input').click()); true`);
  await c.ev(`T.byText('#sendBox button', 'Invia a 3 destinatari').click(); T.byText('button', 'Sì, invia').click(); true`);
  await sleep(600);
  await c.ev(`T.byText('#sendBox button', 'Ferma').click(); true`);
  check('stop finishes', await waitFor(c, `!(T.sendText().includes('Mi fermo'))`, 10000));
  check('stop sends no more', (await c.ev(`__mock.sent.length`)) === 7, String(await c.ev(`__mock.sent.length`)));
  check('stopped recipients stay selected', (await c.ev(`T.chips()`)) === 'Calcetto del giovedì|Capodanno 2027', await c.ev(`T.chips()`));

  // At most 20 recipients per send.
  await c.ev(`T.byText('.tab', 'Contatti').click(); true`);
  await sleep(200);
  await c.ev(`for (let i = 0; i < 19; i++) { const s = T.q('#picker input[type=search]'); T.set(s, '+39 340 000 ' + String(1000 + i)); T.enter(s); } true`);
  check('cap at 20 recipients', (await c.ev(`T.qa('#chips .chip').length`)) === 21 && (await c.ev(`T.sendText()`)).includes('Al massimo 20 destinatari per invio') && (await c.ev(`T.q('#sendBox button').disabled`)));

  // Contacts failing to load: the error shows, typing a number still works.
  await c.ev(`__mock.contactsError = 'ContactStore non disponibile'; T.byText('#picker button', 'Aggiorna').click(); true`);
  check('contact error shown with a way out', await waitFor(c, `T.q('#pickList').innerText.includes('ContactStore non disponibile. Puoi comunque scrivere un numero')`, 3000));
  await c.ev(`T.set(T.q('#picker input[type=search]'), '00393401234567'); true`);
  check('number offered despite the error', !!(await c.ev(`T.q('.addnum')`)));

  await c.ev(`T.byText('button', '‹ Sondaggi').click(); true`);
  await sleep(200);
  check('list summary', (await c.ev(`T.q('.draft .dm').textContent`)) === '3 opzioni · inviato a 4 · 21 da inviare', await c.ev(`T.q('.draft .dm').textContent`));
  await c.ev(`T.q('.draft').click(); true`);
  await sleep(200);
  await c.ev(`T.byText('button', 'Duplica').click(); true`);
  await sleep(200);
  check('duplicate starts with no log', await c.ev(`T.q('#logCard').hidden && !T.q('.infobar') && T.q('#q').value === 'Cena sabato?'`));

  const errors = c.logs.filter((l) => !l.includes('ETag'));
  check('no page errors', errors.length === 0, errors.join(' ; '));

  // Drafts saved by 0.1 kept a recipient selected after sending: it must not be sent twice.
  await c.ev(`sessionStorage.setItem('seed', JSON.stringify({ noticeAck: 1, view: 'edit', currentId: 'old1', drafts: [{ id: 'old1', question: 'Vecchio', options: ['A', 'B'], multiple: false,
    recipients: [{ jid: '120363000001@g.us', label: 'Famiglia' }, { jid: '120363000003@g.us', label: 'Capodanno 2027' }],
    sends: [{ jid: '120363000001@g.us', label: 'Famiglia', ok: true, info: 'x', at: Date.now() - 86400000 }], createdAt: 1, updatedAt: 2 }] })); true`);
  await c.goto(PANEL);
  await c.ev(helpers);
  check('old draft migrated', (await c.ev(`T.chips()`)) === 'Capodanno 2027');
  check('migrated draft skips the notice once acknowledged', await c.ev(`!T.q('.notice')`));
  c.close();
} finally {
  proc.kill();
  server.close();
}
done();
