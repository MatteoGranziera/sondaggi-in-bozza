// A small Chrome DevTools Protocol driver, so the tests need no dependencies.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export function chromeBin({ needsExtensions = false } = {}) {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  // Branded Chrome ignores --load-extension since version 137; Chrome for Testing does not.
  if (needsExtensions) throw new Error('Set CHROME_BIN to a Chrome for Testing or Chromium binary.');
  if (existsSync(MAC_CHROME)) return MAC_CHROME;
  throw new Error('Set CHROME_BIN to a Chrome or Chromium binary.');
}

export async function launch({ bin, port, extra = [] }) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sondaggi-test-'));
  const proc = spawn(bin, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,1000', ...extra,
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); return proc; } catch { await sleep(200); }
  }
  proc.kill();
  throw new Error('Chrome did not start');
}

export const targets = async (port) => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
export const newTab = async (port) => (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  const logs = [];
  const requests = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('exception ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      logs.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    waiting.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  const goto = async (url, settleMs = 1000) => {
    await send('Page.enable');
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      try { if (await ev(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`)) break; } catch {}
    }
    await sleep(settleMs);
  };
  const shot = async (path, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : { captureBeyondViewport: true }) });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  };
  return { ws, send, ev, goto, shot, logs, requests, close: () => ws.close() };
}

export function reporter() {
  const results = [];
  return {
    check(name, ok, detail = '') {
      results.push({ name, ok: !!ok });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? '\n     ' + String(detail).replace(/\n/g, ' | ') : ''}`);
    },
    done() {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      process.exitCode = failed ? 1 : 0;
    },
  };
}
