// Runs in the page's own world next to WA-JS, so it can reach window.WPP.
// The panel cannot: it talks to bridge.js, which forwards here with postMessage.
(() => {
  const TAG = 'sondaggi-wa';
  const wpp = () => window.WPP;
  const safe = (read) => { try { return read(); } catch { return undefined; } };
  const text = (v) => typeof v === 'string' && v.trim() ? v.trim() : '';

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

  function requireOnline() {
    const s = state();
    if (!s.ready) throw new Error('WhatsApp Web si sta ancora caricando.');
    if (!s.authenticated) throw new Error('WhatsApp non è collegato: inquadra il QR nella scheda.');
    if (!s.mainReady) throw new Error('WhatsApp Web sta ancora sincronizzando le chat.');
  }

  // What the panel needs to know about a chat to send a poll there. Flags are compared with
  // === because WA-JS patches some model fields with getters that return functions.
  function chatInfo(chat) {
    const id = chat?.id;
    if (!id) return null;
    const name = [() => chat.formattedTitle, () => chat.name, () => chat.contact?.name, () => chat.contact?.pushname]
      .map((read) => text(safe(read))).find(Boolean) || String(id.user);
    let reason = '';
    if (!['c.us', 'g.us', 'lid'].includes(id.server)) reason = 'Qui i sondaggi non si possono mandare.';
    else if (safe(() => chat.isParentGroup) === true || safe(() => chat.groupMetadata?.groupType) === 'COMMUNITY') {
      reason = 'È una community: apri uno dei suoi gruppi.';
    } else if (safe(() => chat.isReadOnly) === true || safe(() => chat.canSend) === false) {
      reason = 'In questa chat non puoi scrivere.';
    }
    return { id: String(id._serialized), name, isGroup: id.server === 'g.us', reason };
  }

  // Reads a poll out of a message, whether WA-JS hands back a raw message or a model.
  function pollFrom(m) {
    if (!m || m.type !== 'poll_creation') return null;
    const options = (Array.isArray(m.pollOptions) ? m.pollOptions : [])
      .map((o) => String(o?.name ?? '').trim()).filter(Boolean);
    const question = String(m.pollName ?? '').trim();
    if (!question || options.length < 2) return null;
    const id = m.id || {};
    return {
      id: String(id._serialized ?? id ?? ''),
      question,
      options,
      // WhatsApp stores 1 for "one answer" and 0 for "any number of answers".
      multiple: Number(m.pollSelectableOptionsCount ?? 0) !== 1,
      at: (Number(m.t) || 0) * 1000,
      fromMe: !!(id.fromMe ?? m.fromMe),
      author: String(m.notifyName || m.senderObj?.pushname || ''),
    };
  }

  const activeChat = () => chatInfo(wpp().chat.getActiveChat());

  const commands = {
    state,

    activeChat() {
      requireOnline();
      return activeChat();
    },

    // The polls in the chat open in WhatsApp Web, newest first: only what the page already holds.
    async chatPolls() {
      requireOnline();
      const w = wpp();
      const chat = w.chat.getActiveChat();
      if (!chat) throw new Error('Apri in WhatsApp Web la chat con il sondaggio, poi premi Aggiorna.');
      let msgs = await w.chat.getMessages(chat.id, { count: 400 }).catch(() => null);
      if (!Array.isArray(msgs) || !msgs.length) msgs = safe(() => chat.msgs.getModelsArray()) || [];
      const seen = new Set();
      const polls = [];
      for (const m of msgs) {
        const p = safe(() => pollFrom(m));
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        polls.push(p);
      }
      polls.sort((a, b) => b.at - a.at);
      const info = chatInfo(chat);
      return { chat: info.name, chatId: info.id, polls };
    },

    // Sends only to the chat that is open right now, and only if it is the one the panel showed;
    // otherwise nothing goes out and the panel gets the chat that is open instead.
    async sendPoll({ chatId, name, choices, selectableCount }) {
      requireOnline();
      const active = activeChat();
      if (!active || active.id !== chatId || active.reason) return { sent: false, active };
      const res = await wpp().chat.sendCreatePollMessage(chatId, name, choices, {
        selectableCount,
        markIsRead: false,
        // WA-JS fetches link previews from third-party servers; a poll never needs one.
        linkPreview: false,
      });
      return { sent: true, id: String(res?.id ?? '') };
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
    for (const ev of ['conn.authenticated', 'conn.logout', 'conn.main_ready', 'conn.require_auth', 'chat.active_chat']) {
      wpp().on(ev, announce);
    }
  });
})();
