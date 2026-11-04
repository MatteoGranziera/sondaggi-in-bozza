// Exercises language selection and the English UI without touching a real WhatsApp account.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBin, connect, launch, newTab, reporter, sleep } from './lib/cdp.mjs';
import { serve } from './lib/server.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'i18n.js'), 'utf8');
for (const [language, expected] of [['it-IT', 'it'], ['it-CH', 'it'], ['en-GB', 'en'], ['de-DE', 'en']]) {
  const context = { window: {}, navigator: { language }, chrome: { i18n: { getUILanguage: () => language } } };
  vm.runInNewContext(src, context);
  assert.equal(context.window.PollI18n.locale, expected);
  assert.equal(context.window.PollI18n.t('Invia a {0}', 'Famiglia'), expected === 'it' ? 'Invia a Famiglia' : 'Send to Famiglia');
}
const { check, done } = reporter();
const server = await serve(ROOT);
const port = 9500 + Math.floor(Math.random() * 100);
const proc = await launch({ bin: chromeBin(), port });
try {
  const page = await newTab(port);
  const c = await connect(page.webSocketDebuggerUrl);
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__testLanguage = "en-GB";' });
  await c.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1000, deviceScaleFactor: 1, mobile: false });
  await c.send('Network.enable');
  await c.goto(server.url + '/panel.html');
  check('English first-run notice', await c.ev(`document.documentElement.lang === 'en' && document.querySelector('.notice').textContent.includes('Before you start')`), await c.ev(`JSON.stringify({lang:document.documentElement.lang,notice:document.querySelector('.notice').innerText})`));
  await c.ev(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Got it').click()`);
  check('English empty state', await c.ev(`document.querySelector('#view').innerText.includes('No polls yet.')`));
  await c.ev(`sessionStorage.setItem('seed', JSON.stringify({noticeAck:3, view:'edit', currentId:'old', drafts:[{id:'old', question:'Cena venerdì?', options:['Pizza','Sushi'], sends:[], updatedAt:1700000000000}]}))`);
  await c.goto(server.url + '/panel.html');
  check('existing draft survives language change', await c.ev(`document.querySelector('#q').value === 'Cena venerdì?' && document.querySelector('#opts input').value === 'Pizza'`));
  check('English editor and recipient', await c.ev(`document.querySelector('#view').innerText.includes('Question') && document.querySelector('#btnSend').textContent === 'Send to Famiglia'`));
  await c.ev(`__mock.open({id:'readonly@g.us',name:'Annunci',reason:'In questa chat non puoi scrivere.'})`);
  await sleep(400);
  check('page-world reason translated and sending blocked', await c.ev(`document.querySelector('#sendBox').innerText.includes('You cannot send messages in this chat.') && document.querySelector('#btnSend').disabled`));
  await c.ev(`__mock.open({id:'family@g.us',name:'Famiglia',reason:'',isGroup:true})`);
  await sleep(400);
  await c.ev(`document.querySelector('#btnSend').click()`);
  await sleep(350);
  check('sending keeps original poll content', await c.ev(`__mock.sent[0].name === 'Cena venerdì?' && __mock.sent[0].choices[0] === 'Pizza'`));
  check('English history and repeat-send notice', await c.ev(`document.querySelector('#logCard').innerText.includes('successful') && document.querySelector('#sendBox').innerText.includes('already received')`));
  await c.ev(`document.querySelector('.emoji-btn').click()`);
  await sleep(1000);
  check('English emoji picker and local data', await c.ev(`document.querySelector('emoji-picker').locale === 'en' && document.querySelector('emoji-picker').dataSource.endsWith('data-en.json')`));
  await c.ev(`const field = document.querySelector('emoji-picker').shadowRoot.querySelector('input[type=search]'); field.value='hedgehog'; field.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(800);
  check('English emoji search works', await c.ev(`/hedgehog/i.test(document.querySelector('emoji-picker').shadowRoot.querySelector('.emoji-menu [role=option]')?.getAttribute('aria-label') || '')`));
  await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  for (const width of [360, 420]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    check(`English editor fits ${width}px`, await c.ev(`document.documentElement.scrollWidth <= window.innerWidth`));
  }
  const shots = process.env.SHOTS_DIR;
  if (shots) { mkdirSync(shots,{recursive:true}); await c.shot(join(shots,'english-editor.png')); }
  await c.ev(`document.querySelector('.back').click(); [...document.querySelectorAll('button')].find(b=>b.textContent==='From a chat').click()`);
  await sleep(400);
  check('English import keeps original poll text', await c.ev(`document.querySelector('#chatPolls').innerText.includes('Create draft') && document.querySelector('#chatPolls').innerText.includes('Pranzo di domenica')`));
  if (shots) await c.shot(join(shots,'english-import.png'));
  check('no external emoji or tracking requests', c.requests.every(url=>url.startsWith(server.url) || url.startsWith('data:') || url.startsWith('blob:')));
  check('no JavaScript errors', c.logs.filter(x=>x.startsWith('exception') || x.startsWith('error')).length === 0, c.logs.join('\n'));
  c.close();
} finally { proc.kill(); server.close(); }
done();
