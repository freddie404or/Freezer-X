// Message router: parses commands, builds the plugin context, enforces permissions and
// isolates every plugin call so that a failing plugin can never crash the bot.
import { serialize } from './serialize.js';
import { jidToNumber, numberToJid, extractUrls, digits } from './utils.js';

const GROUP_TTL = 60_000;

const asMedia = (kind, src, extra = {}) => (Buffer.isBuffer(src) ? { [kind]: src, ...extra } : { [kind]: { url: src }, ...extra });
const participantNums = (p) => [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(jidToNumber);
const isAdminParticipant = (p) => p?.admin === 'admin' || p?.admin === 'superadmin';

export class Handler {
  /**
   * @param {{sock: any, config: any, db: any, registry: any, logger: any, app: any}} deps
   */
  constructor({ config, db, registry, logger, app }) {
    this.config = config;
    this.db = db;
    this.registry = registry;
    this.logger = logger;
    this.app = app;
    this.sock = null;
    this.groupCache = new Map();
    this.seen = new Set();
    this.cooldown = new Map();
  }

  attach(sock) {
    this.sock = sock;
  }

  get botIds() {
    const u = this.sock?.user || {};
    return [u.id, u.lid, u.jid].filter(Boolean);
  }

  invalidateGroup(jid) {
    if (jid) this.groupCache.delete(jid);
    else this.groupCache.clear();
  }

  async getGroup(jid) {
    const hit = this.groupCache.get(jid);
    if (hit && Date.now() - hit.at < GROUP_TTL) return hit.meta;
    try {
      const meta = await this.sock.groupMetadata(jid);
      this.groupCache.set(jid, { meta, at: Date.now() });
      return meta;
    } catch {
      return hit?.meta ?? null;
    }
  }

  findParticipant(group, ids) {
    const nums = ids.filter(Boolean).map(jidToNumber);
    return group?.participants?.find((p) => participantNums(p).some((n) => nums.includes(n)));
  }

  parseCommand(body) {
    const text = String(body || '').trim();
    const prefixes = this.db.data.settings.prefixes?.length ? this.db.data.settings.prefixes : this.config.prefixes;
    // longest prefix first so "!!" wins over "!"
    for (const prefix of [...prefixes].sort((a, b) => b.length - a.length)) {
      if (!prefix || !text.startsWith(prefix)) continue;
      const rest = text.slice(prefix.length).trimStart();
      const cmd = rest.split(/\s+/)[0]?.toLowerCase();
      if (!cmd) return null;
      return { prefix, command: cmd, text: rest.slice(cmd.length).trim() };
    }
    return null;
  }

  async buildContext(m, parsed) {
    const { sock, config, db } = this;
    const group = m.isGroup ? await this.getGroup(m.chat) : null;
    const botIds = this.botIds;
    const ownerNums = new Set([...config.owners, ...botIds.map(jidToNumber)]);
    const isOwner = m.fromMe || m.senderIds.some((j) => ownerNums.has(jidToNumber(j)));
    const senderP = group ? this.findParticipant(group, m.senderIds) : null;
    const botP = group ? this.findParticipant(group, botIds) : null;
    const text = parsed?.text ?? '';

    const ctx = {
      sock, config, db, registry: this.registry, logger: this.logger, app: this.app,
      msg: m, m, chat: m.chat, sender: m.sender, senderIds: m.senderIds, pushName: m.pushName,
      isGroup: m.isGroup, isOwner, isAdmin: isAdminParticipant(senderP), isBotAdmin: isAdminParticipant(botP),
      group, participants: group?.participants ?? [],
      body: m.body, quoted: m.quoted, mentionsBot: m.mentionsBot, repliesToBot: m.repliesToBot, fromMe: m.fromMe,
      isCommand: Boolean(parsed),
      prefix: parsed?.prefix ?? this.config.prefixes[0],
      command: parsed?.command ?? '',
      text,
      args: text ? text.split(/\s+/) : [],
      plugin: null,
    };

    ctx.reply = (content, extra = {}) =>
      sock.sendMessage(m.chat, typeof content === 'string' ? { text: content, ...extra } : { ...content, ...extra }, { quoted: m.raw });
    ctx.send = (content, options = {}) => sock.sendMessage(m.chat, content, options);
    ctx.react = (emoji) => sock.sendMessage(m.chat, { react: { text: emoji, key: m.key } }).catch(() => {});
    ctx.sendImage = (src, caption = '', extra = {}) => sock.sendMessage(m.chat, asMedia('image', src, { caption, ...extra }), { quoted: m.raw });
    ctx.sendVideo = (src, caption = '', extra = {}) => sock.sendMessage(m.chat, asMedia('video', src, { caption, ...extra }), { quoted: m.raw });
    ctx.sendAudio = (src, { ptt = false, fileName } = {}) =>
      sock.sendMessage(m.chat, asMedia('audio', src, { mimetype: ptt ? 'audio/ogg; codecs=opus' : 'audio/mpeg', ptt, ...(fileName ? { fileName } : {}) }), { quoted: m.raw });
    ctx.sendDocument = (src, fileName, mimetype = 'application/octet-stream', caption = '') =>
      sock.sendMessage(m.chat, asMedia('document', src, { fileName, mimetype, caption }), { quoted: m.raw });
    ctx.sendSticker = (src) => sock.sendMessage(m.chat, asMedia('sticker', src), { quoted: m.raw });
    ctx.usage = () => {
      const p = ctx.plugin;
      return ctx.reply(`📌 *Usage:* ${ctx.prefix}${p?.name ?? ctx.command}${p?.usage ? ` ${p.usage}` : ''}`);
    };

    ctx.getUrl = () => extractUrls(text)[0] || extractUrls(m.quoted?.text)[0] || null;
    ctx.getText = () => text || m.quoted?.text || '';

    ctx.getMedia = async (kinds = ['image', 'video', 'sticker', 'audio']) => {
      const candidates = [];
      if (m.mediaKind) candidates.push({ kind: m.mediaKind, mime: m.mime, source: { key: m.key, message: m.message } });
      if (m.quoted?.mediaKind) candidates.push({ kind: m.quoted.mediaKind, mime: m.quoted.mime, source: { key: m.quoted.key, message: m.quoted.message } });
      const hit = candidates.find((c) => kinds.includes(c.kind));
      if (!hit) return null;
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
      const buffer = await downloadMediaMessage(hit.source, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
      return { kind: hit.kind, mime: hit.mime, buffer };
    };

    /** Participant ids targeted by mentions, a replied message, or phone numbers in the arguments. */
    ctx.getTargets = () => {
      const raw = new Set([...m.mentioned]);
      if (m.quoted?.sender) raw.add(m.quoted.sender);
      for (const a of ctx.args) if (/^@?\+?\d{7,15}$/.test(a)) raw.add(numberToJid(a));
      return [...raw].map((jid) => (group ? this.findParticipant(group, [jid])?.id : jid)).filter(Boolean);
    };

    return ctx;
  }

  /** Entry point for `messages.upsert`. */
  async onMessages({ messages, type }) {
    if (type !== 'notify') return;
    for (const raw of messages) {
      try {
        await this.#process(raw);
      } catch (err) {
        this.logger.error('message handler failed:', err?.message || err);
      }
    }
  }

  async #process(raw) {
    const id = raw?.key?.id;
    if (id) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
      if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    }

    const m = serialize(raw, { botIds: this.botIds });
    if (!m) return;
    if (this.config.autoRead && !m.fromMe) this.sock.readMessages([m.key]).catch(() => {});

    const parsed = this.parseCommand(m.body);
    // Messages sent by the bot's own account are only honoured when they are commands.
    if (m.fromMe && !parsed) return;

    const ctx = await this.buildContext(m, parsed);

    if (m.isGroup && this.db.group(m.chat).banned.includes(jidToNumber(m.sender)) && !ctx.isOwner) return;

    // 1) passive hooks (anti-link, AI chat, ...) - each isolated from the others
    for (const plugin of this.registry.list()) {
      if (typeof plugin.before !== 'function') continue;
      try {
        if ((await plugin.before({ ...ctx, plugin })) === true) return;
      } catch (err) {
        this.logger.error(`hook ${plugin.name}:`, err?.message || err);
      }
    }

    if (!parsed) return;
    const plugin = this.registry.get(parsed.command);
    if (!plugin) return;
    ctx.plugin = plugin;

    const mode = this.db.data.settings.mode || this.config.mode;
    if (mode === 'private' && !ctx.isOwner) return;

    const last = this.cooldown.get(m.sender) || 0;
    if (!ctx.isOwner && Date.now() - last < this.config.cooldownMs) return;
    this.cooldown.set(m.sender, Date.now());
    if (this.cooldown.size > 5000) this.cooldown.clear();

    if (plugin.ownerOnly && !ctx.isOwner) return ctx.reply('👑 This command is for the bot owner only.');
    if (plugin.groupOnly && !m.isGroup) return ctx.reply('👥 This command only works in groups.');
    if (plugin.privateOnly && m.isGroup) return ctx.reply('💬 Use this command in a private chat.');
    if (plugin.adminOnly && !(ctx.isAdmin || ctx.isOwner)) return ctx.reply('🛡️ Only group admins can use this command.');
    if (plugin.botAdmin && !ctx.isBotAdmin) return ctx.reply('🤖 Please make me a group admin first.');

    if (this.config.autoTyping) this.sock.sendPresenceUpdate('composing', m.chat).catch(() => {});
    try {
      await plugin.execute(ctx);
    } catch (err) {
      this.logger.error(`command ${plugin.name}:`, err?.stack || err);
      const msg = String(err?.message || 'Something went wrong').split('\n')[0].slice(0, 200);
      await ctx.reply(`❌ ${msg}`).catch(() => {});
    } finally {
      if (this.config.autoTyping) this.sock.sendPresenceUpdate('paused', m.chat).catch(() => {});
    }
  }

  /** Entry point for `group-participants.update`. */
  async onGroupParticipants(update) {
    this.invalidateGroup(update.id);
    const group = await this.getGroup(update.id);
    const botNums = this.botIds.map(jidToNumber);
    const base = {
      sock: this.sock, config: this.config, db: this.db, registry: this.registry, logger: this.logger, app: this.app,
      // participants: phone-number style ids when available; rawParticipants: ids exactly as WhatsApp sent them
      update: {
        ...update,
        participants: (update.participants || []).map((p) => (typeof p === 'string' ? p : p.phoneNumber || p.id)),
        rawParticipants: (update.participants || []).map((p) => (typeof p === 'string' ? p : p.id)),
      },
      group,
      botIsAdmin: isAdminParticipant(this.findParticipant(group, this.botIds)),
      botNumbers: botNums,
    };
    for (const plugin of this.registry.list()) {
      if (typeof plugin.onGroupUpdate !== 'function') continue;
      try {
        await plugin.onGroupUpdate({ ...base, plugin });
      } catch (err) {
        this.logger.error(`group hook ${plugin.name}:`, err?.message || err);
      }
    }
  }
}

export { digits };
