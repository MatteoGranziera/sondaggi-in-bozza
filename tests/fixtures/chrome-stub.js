// Stands in for the chrome.* APIs and for WhatsApp Web, so the panel runs as a plain page.
// Tests drive it through window.__mock; sessionStorage "seed" preloads chrome.storage.
window.chrome = (() => {
  let store = {};
  try { const seed = sessionStorage.getItem('seed'); if (seed) store = JSON.parse(seed); } catch {}
  const mock = {
    state: { ready: true, authenticated: true, mainReady: true, me: '393330000000:5@c.us' },
    // The chat open in WhatsApp Web, as content/main.js describes it.
    active: { id: '120363000001@g.us', name: 'Famiglia', isGroup: true, reason: '' },
    sent: [],
    failFor: new Set(),
    chatPolls: {
      chat: 'Famiglia',
      polls: [
        { id: 'p2', question: 'Pranzo di domenica: chi porta cosa?', options: ['Dolce', 'Vino', 'Pane'], multiple: true, at: Date.now() - 3600000, fromMe: false, author: 'Mamma' },
        { id: 'p1', question: 'Cena venerdì?', options: ['Pizzeria', 'Sushi'], multiple: false, at: Date.now() - 86400000, fromMe: true, author: '' },
      ],
    },
    chatPollsError: '',
    listeners: [],
    store: () => store,
    // Like clicking another chat in WhatsApp Web: the page announces it.
    open(chat) {
      mock.active = chat;
      for (const fn of mock.listeners) fn({ type: 'wa-state' });
    },
  };
  window.__mock = mock;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    i18n: { getUILanguage: () => window.__testLanguage || 'it' },
    storage: { local: {
      get: async (keys) => { const o = {}; for (const k of keys) if (k in store) o[k] = structuredClone(store[k]); return o; },
      set: async (o) => { Object.assign(store, structuredClone(o)); },
    } },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, active: true, status: 'complete', url: 'https://web.whatsapp.com/' }],
      sendMessage: async (_id, msg) => {
        await wait(100);
        if (msg.cmd === 'state') return { ok: true, result: mock.state };
        if (msg.cmd === 'activeChat') return { ok: true, result: mock.active };
        if (msg.cmd === 'chatPolls') return mock.chatPollsError ? { ok: false, error: mock.chatPollsError } : { ok: true, result: { ...mock.chatPolls, chatId: mock.active?.id || '' } };
        if (msg.cmd === 'sendPoll') {
          const a = mock.active;
          if (!a || a.id !== msg.args.chatId || a.reason) return { ok: true, result: { sent: false, active: a } };
          mock.sent.push(msg.args);
          if (mock.failFor.has(msg.args.chatId)) return { ok: false, error: 'Non puoi scrivere in questo gruppo.' };
          return { ok: true, result: { sent: true, id: 'true_' + msg.args.chatId + '_ABC' } };
        }
        return { ok: false, error: 'unknown command' };
      },
      create: async () => {}, update: async () => {}, reload: async () => {},
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
    },
    windows: { getCurrent: async () => ({ id: 1 }), update: async () => {} },
    runtime: { onMessage: { addListener(fn) { mock.listeners.push(fn); } } },
  };
})();
