// Renders the Chrome Web Store screenshots (1280x800) from the real panel with sample data.
// Run: node store/screenshots.mjs        Italian screenshots and the promo tile, in store/
//      node store/screenshots.mjs en     English screenshots, in store/en/
// The promo tile is one for every language in the Store, so only the Italian run draws it.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBin, connect, launch, newTab, sleep } from '../tests/lib/cdp.mjs';
import { serve } from '../tests/lib/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lang = process.argv[2] === 'en' ? 'en' : 'it';
const OUT = lang === 'en' ? join(ROOT, 'store', 'en') : join(ROOT, 'store');
const port = 9700 + Math.floor(Math.random() * 100);
const DAY = 86400000;
const now = Date.now();

const TEXT = {
  it: {
    uiLanguage: 'it-IT',
    fine: 'Progetto indipendente, non affiliato a WhatsApp né a Meta.',
    question: 'Cena di classe: quale sera vi va meglio?',
    options: ['Venerdì 14 🍕', 'Sabato 15 🍷', 'Domenica 16 ☀️'],
    oldQuestion: 'Cena di classe: quando?',
    oldOptions: ['Venerdì', 'Sabato'],
    chats: ['Classe 3B', 'Giulia Bianchi', 'Calcetto del giovedì'],
    // null keeps the open chat and its polls from the test stub, which are in Italian.
    active: null,
    chatPolls: null,
    fromChatButton: 'Da una chat',
    shots: [
      {
        file: 'screenshot-1-bozza.png',
        title: 'Prepara il sondaggio con calma',
        points: ['Domanda e opzioni con le emoji, cercate in italiano', 'Anteprima di come arriva in chat', 'Resta in bozza finché non decidi di mandarlo'],
      },
      {
        file: 'screenshot-2-conferma.png',
        title: 'Mandalo nella chat aperta',
        points: ['Apri la chat in WhatsApp Web: il tasto prende il suo nome', 'Anteprima e destinatario davanti agli occhi, poi un clic', 'Prova con un amico, poi apri il gruppo e mandalo lì'],
        preview: true,
      },
      {
        file: 'screenshot-3-registro.png',
        title: 'Modificalo quando vuoi',
        points: ['Le modifiche valgono per i prossimi invii', 'Il registro dice a chi è arrivato, quando e con quale testo', 'Tutto resta nel tuo browser'],
        bottom: true,
      },
      {
        file: 'screenshot-4-da-una-chat.png',
        title: 'Riparti da un sondaggio che c\'è già',
        points: ['Apri la chat in WhatsApp Web e scegli il sondaggio', 'Diventa una bozza da correggere e rimandare', 'Il sondaggio in chat resta com\'è'],
        fromChat: true,
      },
    ],
  },
  en: {
    uiLanguage: 'en-US',
    fine: 'Independent project, not affiliated with WhatsApp or Meta.',
    question: 'Class dinner: which night works best?',
    options: ['Friday 14th 🍕', 'Saturday 15th 🍷', 'Sunday 16th ☀️'],
    oldQuestion: 'Class dinner: when?',
    oldOptions: ['Friday', 'Saturday'],
    chats: ['Class of 2015', 'Julia Brown', 'Thursday football'],
    active: { id: '120363000002@g.us', name: 'Family', isGroup: true, reason: '' },
    chatPolls: {
      chat: 'Family',
      polls: [
        { id: 'p2', question: 'Sunday lunch: who brings what?', options: ['Dessert', 'Wine', 'Bread'], multiple: true, at: now - 3600000, fromMe: false, author: 'Mum' },
        { id: 'p1', question: 'Dinner on Friday?', options: ['Pizza place', 'Sushi'], multiple: false, at: now - DAY, fromMe: true, author: '' },
      ],
    },
    fromChatButton: 'From a chat',
    shots: [
      {
        file: 'screenshot-1-draft.png',
        title: 'Write your poll at your own pace',
        points: ['Question and options with emoji, searchable in English', 'A preview of how it will look in the chat', 'It stays a draft until you decide to send it'],
      },
      {
        file: 'screenshot-2-send.png',
        title: 'Send it to the open chat',
        points: ['Open the chat in WhatsApp Web: the button shows its name', 'Preview and recipient in front of you, then one click', 'Try it with a friend, then open the group and send it there'],
        preview: true,
      },
      {
        file: 'screenshot-3-log.png',
        title: 'Edit it whenever you like',
        points: ['Changes apply to the next sends', 'The log shows who got it, when and with which text', 'Everything stays in your browser'],
        bottom: true,
      },
      {
        file: 'screenshot-4-from-a-chat.png',
        title: 'Start from a poll already in a chat',
        points: ['Open the chat in WhatsApp Web and pick the poll', 'It becomes a draft to fix and send again', 'The poll in the chat stays as it is'],
        fromChat: true,
      },
    ],
  },
}[lang];

const send = (chat, at, question, choices, multiple) => ({ jid: chat[0], label: chat[1], ok: true, info: '', at, question, choices, multiple });
const draft = {
  v: 4, id: 'demo', question: TEXT.question, options: TEXT.options, multiple: true,
  sends: [
    send(['120363000009@g.us', TEXT.chats[0]], now - DAY, TEXT.question, TEXT.options, true),
    send(['393337654321@c.us', TEXT.chats[1]], now - DAY + 4000, TEXT.question, TEXT.options, true),
    send(['120363000008@g.us', TEXT.chats[2]], now - 2 * DAY, TEXT.oldQuestion, TEXT.oldOptions, false),
  ],
  createdAt: now - 3 * DAY, updatedAt: now - 600000,
};

mkdirSync(OUT, { recursive: true });
const server = await serve(ROOT);
const proc = await launch({ bin: chromeBin(), port });
try {
  const tab = await newTab(port);
  const c = await connect(tab.webSocketDebuggerUrl);
  // Runs in the panel's frame too, before the stub: the panel then picks this language.
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__testLanguage = ${JSON.stringify(TEXT.uiLanguage)};` });
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await c.goto(server.url + '/store/showcase.html', 200);
  await c.ev(`document.documentElement.lang = ${JSON.stringify(lang)}; document.querySelector('.fine').textContent = ${JSON.stringify(TEXT.fine)}; true`);
  for (const s of TEXT.shots) {
    await c.ev(`(() => {
      sessionStorage.setItem('seed', ${JSON.stringify(JSON.stringify({ noticeAck: 3, view: 'edit', currentId: 'demo', drafts: [draft] }))});
      document.getElementById('title').textContent = ${JSON.stringify(s.title)};
      document.getElementById('points').replaceChildren(...${JSON.stringify(s.points)}.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
      document.getElementById('panel').src = '/panel.html?' + Date.now();
    })(); true`);
    await sleep(2500);
    const frame = `document.getElementById('panel').contentWindow`;
    if (TEXT.active) {
      await c.ev(`(() => { const m = ${frame}.__mock; m.chatPolls = ${JSON.stringify(TEXT.chatPolls)}; m.open(${JSON.stringify(TEXT.active)}); })(); true`);
      await sleep(800);
    }
    await c.ev(`${frame}.document.documentElement.style.scrollbarWidth = 'none'; true`);
    if (s.preview) {
      await c.ev(`(() => { const d = ${frame}.document; const card = d.querySelector('#preview').closest('.card'); ${frame}.scrollTo(0, card.offsetTop - 260); })(); true`);
    }
    if (s.bottom) await c.ev(`${frame}.scrollTo(0, ${frame}.document.body.scrollHeight); true`);
    if (s.fromChat) {
      await c.ev(`(() => { const d = ${frame}.document; [...d.querySelectorAll('button')].find((b) => b.textContent.startsWith('‹')).click(); })(); true`);
      await sleep(200);
      await c.ev(`(() => { const d = ${frame}.document; [...d.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(TEXT.fromChatButton)}).click(); })(); true`);
      await sleep(800);
    }
    await sleep(400);
    await c.shot(join(OUT, s.file), { x: 0, y: 0, width: 1280, height: 800 });
    console.log(join(OUT, s.file));
  }

  if (lang === 'it') {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 440, height: 280, deviceScaleFactor: 1, mobile: false });
    await c.goto(server.url + '/store/promo.html', 300);
    await c.shot(join(OUT, 'promo-small-440x280.png'), { x: 0, y: 0, width: 440, height: 280 });
    console.log(join(OUT, 'promo-small-440x280.png'));
  }
  c.close();
} finally {
  proc.kill();
  server.close();
}
