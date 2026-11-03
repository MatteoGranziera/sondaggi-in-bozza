// Stands in for the chrome.* APIs and for WhatsApp Web, so the panel runs as a plain page.
// Tests drive it through window.__mock; sessionStorage "seed" preloads chrome.storage.
window.chrome = (() => {
  let store = {};
  try { const seed = sessionStorage.getItem('seed'); if (seed) store = JSON.parse(seed); } catch {}
  const groups = [
    { id: '120363000001@g.us', name: 'Famiglia' },
    { id: '120363000002@g.us', name: 'Calcetto del giovedì' },
    { id: '120363000003@g.us', name: 'Capodanno 2027' },
  ];
  const contacts = [
    { id: '393331112222@c.us', name: 'Mario Rossi', phone: '393331112222' },
    { id: '393337654321@c.us', name: 'Giulia Bianchi', phone: '393337654321' },
    { id: '99887766@lid', name: 'Zoë', phone: '' },
  ];
  const mock = {
    state: { ready: true, authenticated: true, mainReady: true, me: '393330000000:5@c.us' },
    sent: [],
    failFor: new Set(['120363000002@g.us']),
    contactsError: '',
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
  };
  window.__mock = mock;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    storage: { local: {
      get: async (keys) => { const o = {}; for (const k of keys) if (k in store) o[k] = structuredClone(store[k]); return o; },
      set: async (o) => { Object.assign(store, structuredClone(o)); },
    } },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, active: true, status: 'complete', url: 'https://web.whatsapp.com/' }],
      sendMessage: async (_id, msg) => {
        await wait(100);
        if (msg.cmd === 'state') return { ok: true, result: mock.state };
        if (msg.cmd === 'groups') return { ok: true, result: groups };
        if (msg.cmd === 'contacts') return mock.contactsError ? { ok: false, error: mock.contactsError } : { ok: true, result: contacts };
        if (msg.cmd === 'chatPolls') return mock.chatPollsError ? { ok: false, error: mock.chatPollsError } : { ok: true, result: mock.chatPolls };
        if (msg.cmd === 'sendPoll') {
          mock.sent.push(msg.args);
          if (mock.failFor.has(msg.args.chatId)) return { ok: false, error: 'Non puoi scrivere in questo gruppo.' };
          return { ok: true, result: { id: 'true_' + msg.args.chatId + '_ABC' } };
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
