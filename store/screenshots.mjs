// Renders the Chrome Web Store screenshots (1280x800) from the real panel with sample data.
// Run: node store/screenshots.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBin, connect, launch, newTab, sleep } from '../tests/lib/cdp.mjs';
import { serve } from '../tests/lib/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store');
const port = 9700 + Math.floor(Math.random() * 100);
const DAY = 86400000;
const now = Date.now();

const draft = {
  v: 4, id: 'demo', question: 'Cena di classe: quale sera vi va meglio?',
  options: ['Venerdì 14 🍕', 'Sabato 15 🍷', 'Domenica 16 ☀️'], multiple: true,
  sends: [
    { jid: '120363000009@g.us', label: 'Classe 3B', ok: true, info: '', at: now - DAY, question: 'Cena di classe: quale sera vi va meglio?', choices: ['Venerdì 14 🍕', 'Sabato 15 🍷', 'Domenica 16 ☀️'], multiple: true },
    { jid: '393337654321@c.us', label: 'Giulia Bianchi', ok: true, info: '', at: now - DAY + 4000, question: 'Cena di classe: quale sera vi va meglio?', choices: ['Venerdì 14 🍕', 'Sabato 15 🍷', 'Domenica 16 ☀️'], multiple: true },
    { jid: '120363000008@g.us', label: 'Calcetto del giovedì', ok: true, info: '', at: now - 2 * DAY, question: 'Cena di classe: quando?', choices: ['Venerdì', 'Sabato'], multiple: false },
  ],
  createdAt: now - 3 * DAY, updatedAt: now - 600000,
};

const shots = [
  {
    file: 'screenshot-1-bozza.png',
    title: 'Prepara il sondaggio con calma',
    points: ['Domanda e opzioni con le emoji, cercate in italiano', 'Anteprima di come arriva in chat', 'Resta in bozza finché non decidi di mandarlo'],
    scroll: 0,
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
];

const server = await serve(ROOT);
const proc = await launch({ bin: chromeBin(), port });
try {
  const tab = await newTab(port);
  const c = await connect(tab.webSocketDebuggerUrl);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await c.goto(server.url + '/store/showcase.html', 200);
  for (const s of shots) {
    await c.ev(`(() => {
      sessionStorage.setItem('seed', ${JSON.stringify(JSON.stringify({ noticeAck: 3, view: 'edit', currentId: 'demo', drafts: [draft] }))});
      document.getElementById('title').textContent = ${JSON.stringify(s.title)};
      document.getElementById('points').replaceChildren(...${JSON.stringify(s.points)}.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
      document.getElementById('panel').src = '/panel.html?' + Date.now();
    })(); true`);
    await sleep(2500);
    const frame = `document.getElementById('panel').contentWindow`;
    await c.ev(`${frame}.document.documentElement.style.scrollbarWidth = 'none'; true`);
    if (s.preview) {
      await c.ev(`(() => { const d = ${frame}.document; const card = d.querySelector('#preview').closest('.card'); ${frame}.scrollTo(0, card.offsetTop - 260); })(); true`);
    }
    if (s.bottom) await c.ev(`${frame}.scrollTo(0, ${frame}.document.body.scrollHeight); true`);
    if (s.fromChat) {
      await c.ev(`(() => { const d = ${frame}.document; [...d.querySelectorAll('button')].find((b) => b.textContent.startsWith('‹')).click(); })(); true`);
      await sleep(200);
      await c.ev(`(() => { const d = ${frame}.document; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Da una chat').click(); })(); true`);
      await sleep(800);
    }
    await sleep(400);
    await c.shot(join(OUT, s.file), { x: 0, y: 0, width: 1280, height: 800 });
    console.log(join(OUT, s.file));
  }

  // The small promo tile the store shows in search results and category pages.
  await c.send('Emulation.setDeviceMetricsOverride', { width: 440, height: 280, deviceScaleFactor: 1, mobile: false });
  await c.goto(server.url + '/store/promo.html', 300);
  await c.shot(join(OUT, 'promo-small-440x280.png'), { x: 0, y: 0, width: 440, height: 280 });
  console.log(join(OUT, 'promo-small-440x280.png'));
  c.close();
} finally {
  proc.kill();
  server.close();
}
