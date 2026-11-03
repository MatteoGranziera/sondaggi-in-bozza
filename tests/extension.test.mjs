// Loads the real extension and opens the real web.whatsapp.com, logged out: WA-JS must hook in,
// analytics must stay off, and the panel must reach the page through the bridge.
// Needs a browser that still honours --load-extension, for example Chrome for Testing:
//   CHROME_BIN=".../Google Chrome for Testing" node tests/extension.test.mjs
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
  await wa.send('Network.enable');
  await wa.goto('https://web.whatsapp.com/', 0);
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    await sleep(1000);
    ready = await wa.ev(`!!window.WPP?.loader?.isReady`).catch(() => false);
  }
  check('WA-JS ready on WhatsApp Web', ready);
  check('WA-JS analytics disabled', await wa.ev(`WPP.config.disableGoogleAnalytics === true`));
  await sleep(5000);
  const tracked = wa.requests.filter((u) => TRACKERS.test(u));
  check('no requests to analytics or link-preview servers', tracked.length === 0, tracked.join(' '));

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
