// Isolated world: the only side that can use chrome.runtime. Relays panel
// requests to main.js and its answers back.
(() => {
  const TAG = 'sondaggi-wa';
  const waiting = new Map();
  let seq = 0;

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m) return;
    if (m[TAG] === 'res' && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    } else if (m[TAG] === 'event') {
      chrome.runtime.sendMessage({ type: 'wa-state' }).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'wa') return;
    const id = `${++seq}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      waiting.delete(id);
      sendResponse({ ok: false, error: 'WhatsApp Web non risponde.' });
    }, msg.cmd === 'sendPoll' ? 60000 : 20000);
    waiting.set(id, (m) => {
      clearTimeout(timer);
      sendResponse({ ok: m.ok, result: m.result, error: m.error });
    });
    window.postMessage({ [TAG]: 'req', id, cmd: msg.cmd, args: msg.args }, location.origin);
    return true;
  });
})();
