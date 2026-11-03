// Runs in the page's own world next to WA-JS, so it can reach window.WPP.
// The panel cannot: it talks to bridge.js, which forwards here with postMessage.
(() => {
  const TAG = 'sondaggi-wa';
  const wpp = () => window.WPP;

  function state() {
    const w = wpp();
    // The top-level WPP.isReady is a snapshot taken at load; only the loader's flag goes live.
    if (!w || !(w.loader?.isReady || w.isReady)) return { ready: false };
    let me = '';
    try { me = w.conn.getMyUserId()?._serialized || ''; } catch {}
    return {
      ready: true,
      authenticated: w.conn.isAuthenticated(),
      mainReady: w.conn.isMainReady(),
      me,
      version: w.version,
    };
  }

  const safe = (read) => { try { return read(); } catch { return undefined; } };

  // WA-JS patches ContactModel with getters, and some return functions instead of
  // booleans (isGroup, isUser), so the id's server decides what is a person.
  function person(model, contact) {
    const id = model?.id;
    if (!id || (id.server !== 'c.us' && id.server !== 'lid')) return null;
    const c = contact || {};
    // A LID hides the number; when WhatsApp knows it, the number is the safer address.
    const pn = id.server === 'c.us' ? id : (safe(() => c.phoneNumber) || safe(() => c.pnForLid));
    const phone = pn && pn.user ? String(pn.user) : '';
    // formattedName comes last: without a saved name it reads "Unknown user".
    const name = [() => c.name, () => c.pushname, () => c.notifyName, () => model.formattedTitle, () => c.formattedName]
      .map(safe).find((v) => typeof v === 'string' && v.trim());
    return {
      key: phone || id._serialized,
      id: phone ? phone + '@c.us' : id._serialized,
      name: name ? name.trim() : phone ? '+' + phone : String(id.user),
      phone,
    };
  }

  function requireOnline() {
    const s = state();
    if (!s.ready) throw new Error('WhatsApp Web si sta ancora caricando.');
    if (!s.authenticated) throw new Error('WhatsApp non è collegato: inquadra il QR nella scheda.');
    if (!s.mainReady) throw new Error('WhatsApp Web sta ancora sincronizzando le chat.');
  }

  const commands = {
    state,

    async groups() {
      requireOnline();
      const chats = await wpp().chat.list({ onlyGroups: true });
      return chats
        // A community's parent is listed as a group but takes no messages.
        .filter((c) => !c.isReadOnly && c.groupMetadata?.groupType !== 'COMMUNITY')
        .map((c) => ({ id: c.id._serialized, name: c.formattedTitle || c.name || c.id.user }));
    },

    // Address book first, then the people you chat with: either source alone can come back
    // empty or throw on some WhatsApp Web versions.
    async contacts() {
      requireOnline();
      const w = wpp();
      const byKey = new Map();
      const add = (p) => { if (p && !byKey.has(p.key)) byKey.set(p.key, { id: p.id, name: p.name, phone: p.phone }); };
      let failure = null;
      const saved = await w.contact.list({ onlyMyContacts: true }).catch((e) => { failure = e; return []; });
      for (const c of saved) add(person(c, c));
      const chats = await w.chat.list({ onlyUsers: true }).catch((e) => { failure ||= e; return []; });
      for (const ch of chats) add(person(ch, safe(() => ch.contact)));
      if (!byKey.size && failure) throw failure;
      return [...byKey.values()];
    },

    async sendPoll({ chatId, name, choices, selectableCount }) {
      requireOnline();
      const res = await wpp().chat.sendCreatePollMessage(chatId, name, choices, {
        selectableCount,
        markIsRead: false,
        // WA-JS fetches link previews from third-party servers; a poll never needs one.
        linkPreview: false,
      });
      return { id: String(res?.id ?? '') };
    },
  };

  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (e.source !== window || !m || m[TAG] !== 'req') return;
    let out;
    try {
      const fn = commands[m.cmd];
      if (!fn) throw new Error('Comando sconosciuto: ' + m.cmd);
      out = { ok: true, result: await fn(m.args || {}) };
    } catch (err) {
      out = { ok: false, error: err?.message || (typeof err === 'string' ? err : 'WhatsApp Web ha rifiutato la richiesta.') };
    }
    window.postMessage({ [TAG]: 'res', id: m.id, ...out }, location.origin);
  });

  const announce = () => window.postMessage({ [TAG]: 'event' }, location.origin);
  wpp()?.loader?.onReady(() => {
    announce();
    for (const ev of ['conn.authenticated', 'conn.logout', 'conn.main_ready', 'conn.require_auth']) {
      wpp().on(ev, announce);
    }
  });
})();
