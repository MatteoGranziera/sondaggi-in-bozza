// Loads the real extension and opens the real web.whatsapp.com, logged out: WA-JS must hook in,
// analytics must stay off, and the panel must reach the page through the bridge.
// Needs a browser that still honours --load-extension, for example Chrome for Testing:
//   CHROME_BIN=".../Google Chrome for Testing" node tests/extension.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBin, connect, launch, newTab, reporter, sleep, targets } from './lib/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 9800 + Math.floor(Math.random() * 100);
// WhatsApp Web turns away browsers that announce themselves as headless.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const TRACKERS = /google-analytics\.com|googletagmanager\.com|uppermesh\.com|titanchat\.com|cloudtrix\.com/;
const { check, done } = reporter();
const proc = await launch({
  bin: chromeBin({ needsExtensions: true }), port,
  extra: [`--load-extension=${ROOT}`, `--disable-extensions-except=${ROOT}`, `--user-agent=${UA}`],
});

try {
  let extId = null;
  for (let i = 0; i < 50 && !extId; i++) {
    const worker = (await targets(port)).find((t) => t.url.startsWith('chrome-extension://') && t.url.endsWith('/background.js'));
    if (worker) extId = new URL(worker.url).host;
    else await sleep(200);
  }
  check('extension loads', !!extId);

  const waTab = await newTab(port);
  const wa = await connect(waTab.webSocketDebuggerUrl);
  // What chrome://extensions lists as the extension's errors: those raised from its own scripts.
  const extErrors = [];
  wa.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    const p = m.params;
    const top = (p?.stackTrace ?? p?.exceptionDetails?.stackTrace)?.callFrames?.[0]?.url ?? '';
    if (!top.startsWith('chrome-extension://')) return;
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(p.type)) extErrors.push(p.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') extErrors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
  });
  await wa.send('Network.enable');
  await wa.goto('https://web.whatsapp.com/', 0);
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    await sleep(1000);
    ready = await wa.ev(`!!window.WPP?.loader?.isReady`).catch(() => false);
  }
  check('WA-JS ready on WhatsApp Web', ready);
  check('WA-JS analytics disabled', await wa.ev(`WPP.config.disableGoogleAnalytics === true`));
  check('WA-JS has every function the extension calls', await wa.ev(`['getActiveChat', 'getMessages', 'sendCreatePollMessage'].every((f) => typeof WPP.chat[f] === 'function')
    && typeof WPP.conn.isMainReady === 'function' && typeof WPP.on === 'function'`));

  // The readers in main.js, run on real WhatsApp Web models built here.
  const src = readFileSync(join(ROOT, 'content/main.js'), 'utf8');
  const readers = ['const safe = [^\\n]+\\n', 'const text = [^\\n]+\\n', 'function chatInfo\\([\\s\\S]*?\\n  }\\n', 'function pollFrom\\([\\s\\S]*?\\n  }\\n']
    .map((re) => src.match(new RegExp(re))[0]).join('\n');
  const read = JSON.parse(await wa.ev(`(() => {
    ${readers}
    const W = WPP.whatsapp;
    const wid = (s) => (W.WidFactory?.createWid || WPP.util.createWid)(s);
    const chat = (attrs) => { try { return chatInfo(new W.ChatModel(attrs)); } catch (e) { return { error: e.message }; } };
    // getMessages hands back serialized messages; this is their shape for a poll.
    const raw = { id: { fromMe: false, remote: '120363000001@g.us', id: 'TESTPOLL', _serialized: 'false_120363000001@g.us_TESTPOLL' },
      type: 'poll_creation', pollName: 'Cena?', t: 1700000000, notifyName: 'Mario',
      pollOptions: [{ name: 'Pizza', localId: 0 }, { name: 'Sushi', localId: 1 }], pollSelectableOptionsCount: 1 };
    // A real MsgKey needs a logged-in account; the model is tried with the raw id instead.
    let fromModel = null, modelError = '';
    try { fromModel = pollFrom(new W.MsgModel(raw)); } catch (e) { modelError = e.message; }
    return JSON.stringify({
      group: chat({ id: wid('120363000001@g.us'), name: 'Famiglia' }),
      user: chat({ id: wid('393331112222@c.us'), name: 'Mario Rossi' }),
      readOnly: chat({ id: wid('393337654321@c.us'), name: 'Giulia', isReadOnly: true }),
      channel: chat({ id: wid('120363000005@newsletter'), name: 'Canale' }),
      none: chatInfo(null),
      fromModel, modelError,
      fromRaw: pollFrom(raw),
      notAPoll: pollFrom({ ...raw, type: 'chat', body: 'ciao' }),
    });
  })()`));
  // A group model needs a logged-in account (WhatsApp asks for the user's LID).
  if (read.group?.error) console.log(`skip a group chat can take a poll (logged out: ${read.group.error})`);
  else check('a group chat can take a poll', read.group?.id === '120363000001@g.us' && read.group.isGroup === true && read.group.reason === '', JSON.stringify(read.group));
  // The name is the chat's title as WhatsApp shows it: the formatted number for someone not saved.
  check('a person chat can take a poll', read.user?.id === '393331112222@c.us' && read.user.name.replace(/\D/g, '') === '393331112222' && read.user.isGroup === false && read.user.reason === '', JSON.stringify(read.user));
  check('a read-only chat is refused', read.readOnly?.reason === 'In questa chat non puoi scrivere.', JSON.stringify(read.readOnly));
  check('a channel is refused', !!read.channel?.reason, JSON.stringify(read.channel));
  check('no chat reads as none', read.none === null);
  const expected = { question: 'Cena?', options: ['Pizza', 'Sushi'], multiple: false, at: 1700000000000, fromMe: false, author: 'Mario' };
  const same = (p) => p && Object.entries(expected).every(([k, v]) => JSON.stringify(p[k]) === JSON.stringify(v));
  check('poll read from a raw message', same(read.fromRaw), JSON.stringify(read.fromRaw));
  if (read.modelError) console.log(`skip poll read from a message model (logged out: ${read.modelError})`);
  else check('poll read from a message model', same(read.fromModel), JSON.stringify(read.fromModel));
  check('other messages are not polls', read.notAPoll === null);
  await sleep(5000);
  const tracked = wa.requests.filter((u) => TRACKERS.test(u));
  check('no requests to analytics or link-preview servers', tracked.length === 0, tracked.join(' '));
  check('no extension errors on WhatsApp Web', extErrors.length === 0, extErrors.join(' ; '));

  const panelTab = await newTab(port);
  const panel = await connect(panelTab.webSocketDebuggerUrl);
  await panel.goto(`chrome-extension://${extId}/panel.html`, 4000);
  check('panel reaches WhatsApp Web through the bridge', (await panel.ev(`document.querySelector('#pill').textContent`)) === 'WhatsApp non è collegato');
  await panel.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Ho capito')?.click(); true`);
  await panel.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Nuovo').click(); true`);
  await sleep(300);
  await panel.ev(`document.querySelector('#q').parentElement.querySelector('.emoji-btn').click(); true`);
  let results = 0;
  for (let i = 0; i < 40 && !results; i++) {
    await sleep(250);
    results = await panel.ev(`(() => {
      const r = document.querySelector('emoji-picker')?.shadowRoot;
      const s = r?.querySelector('#search');
      if (!s) return 0;
      if (s.value !== 'cuore') { s.value = 'cuore'; s.dispatchEvent(new Event('input', { bubbles: true, composed: true })); return 0; }
      return r.querySelectorAll('.emoji-menu [role=option]').length;
    })()`);
  }
  check('emoji picker works inside the extension', results > 0, String(results));
  check('no panel errors', panel.logs.filter((l) => !l.includes('ETag')).length === 0, panel.logs.join(' ; '));
  wa.close();
  panel.close();
} finally {
  proc.kill();
}
done();
