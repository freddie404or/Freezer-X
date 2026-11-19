// WhatsApp connection manager (Baileys): QR + pairing-code auth, session handling, reconnects.
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys';
import { paint } from './logger.js';
import { digits, jidToNumber, numberToJid } from './utils.js';
import { loadSession } from './session.js';

const baileysLogger = pino({ level: process.env.BAILEYS_LOG || 'silent' });

export class Connection {
  constructor({ config, logger, handler, db }) {
    this.config = config;
    this.logger = logger;
    this.handler = handler;
    this.db = db;
    this.sock = null;
    this.status = 'starting'; // starting | waiting_auth | connecting | connected | logged_out | stopped
    this.qr = null;
    this.pairingCode = null;
    this.awaitingAuth = false;
    this.attempts = 0;
    this.stopped = false;
    this.starting = false;
    this.sent = new Map(); // tiny message cache for retries
    this.autoPairTried = false;
  }

  get user() {
    return this.sock?.user ?? null;
  }

  async start() {
    if (this.starting || this.stopped) return;
    this.starting = true;
    try {
      await loadSession(this.config.sessionId, this.config.sessionDir, this.logger);
      fs.mkdirSync(this.config.sessionDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionDir);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

      this.status = state.creds.registered ? 'connecting' : 'starting';
      this.qr = null;
      this.pairingCode = null;
      this.awaitingAuth = false;

      const sock = makeWASocket({
        ...(version ? { version } : {}),
        logger: baileysLogger,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        cachedGroupMetadata: async (jid) => (await this.handler.getGroup(jid)) ?? undefined,
        getMessage: async (key) => this.sent.get(key.id)?.message ?? undefined,
      });
      this.sock = sock;
      this.handler.attach(sock);

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (u) => this.#onConnectionUpdate(u));
      sock.ev.on('messages.upsert', (u) => {
        for (const msg of u.messages || []) {
          if (msg.key?.id && msg.message) {
            this.sent.set(msg.key.id, msg);
            if (this.sent.size > 500) this.sent.delete(this.sent.keys().next().value);
          }
        }
        this.handler.onMessages(u).catch((e) => this.logger.error('upsert:', e?.message || e));
      });
      sock.ev.on('group-participants.update', (u) => this.handler.onGroupParticipants(u).catch((e) => this.logger.error('group event:', e?.message || e)));
      sock.ev.on('groups.update', (list) => list.forEach((g) => this.handler.invalidateGroup(g.id)));
    } catch (err) {
      this.logger.error('Failed to start connection:', err?.message || err);
      this.#scheduleReconnect();
    } finally {
      this.starting = false;
    }
  }

  async #onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.awaitingAuth = true;
      this.status = 'waiting_auth';
      if (this.config.pairingNumber && !this.autoPairTried) {
        this.autoPairTried = true;
        await this.requestPairing(this.config.pairingNumber).catch((e) => this.logger.error('Pairing failed:', e.message));
      } else if (!this.pairingCode) {
        this.qr = qr;
        await this.#printQr(qr);
      }
    }

    if (connection === 'connecting' && this.status !== 'waiting_auth') this.status = 'connecting';

    if (connection === 'open') {
      this.status = 'connected';
      this.qr = null;
      this.pairingCode = null;
      this.awaitingAuth = false;
      this.attempts = 0;
      const id = this.user?.id ? jidToNumber(this.user.id) : 'unknown';
      this.logger.ok(`${paint.bold('Connected')} as +${id} (${this.user?.name || 'no name'})`);
      this.#notifyOwner(id).catch(() => {});
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      this.status = 'connecting';
      this.awaitingAuth = false;
      this.pairingCode = null;
      this.qr = null;

      if (code === DisconnectReason.loggedOut) {
        this.logger.warn('Logged out from WhatsApp - clearing session, a new login is required.');
        this.status = 'logged_out';
        fs.rmSync(this.config.sessionDir, { recursive: true, force: true });
        this.autoPairTried = false;
        return setTimeout(() => this.start(), 2000);
      }
      if (code === DisconnectReason.connectionReplaced) {
        this.logger.error('Session was opened somewhere else (connection replaced). Stopping.');
        this.stopped = true;
        this.status = 'stopped';
        return;
      }
      if (code === DisconnectReason.restartRequired) {
        this.logger.info('WhatsApp asked for a restart - reconnecting…');
        return this.start();
      }
      this.logger.warn(`Connection closed (${code ?? lastDisconnect?.error?.message ?? 'unknown'}) - reconnecting…`);
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect() {
    if (this.stopped) return;
    this.attempts += 1;
    const delay = Math.min(3000 * this.attempts, 30000);
    setTimeout(() => this.start(), delay).unref?.();
  }

  async #printQr(qr) {
    try {
      const QR = (await import('qrcode')).default;
      const art = await QR.toString(qr, { type: 'terminal', small: true });
      console.log(`\n${paint.ice('  Scan this QR code in WhatsApp → Linked devices → Link a device')}\n`);
      console.log(art);
      console.log(paint.dim(`  Or open the web page on port ${this.config.port} to use a pairing code.\n`));
    } catch {
      this.logger.info('QR code ready - open the web connect page to scan it.');
    }
  }

  async #notifyOwner(botNumber) {
    if (!this.config.notifyOwnerOnStart) return;
    const target = this.config.owners[0] || botNumber;
    if (!target || target === 'unknown') return;
    const stats = this.handler.registry.stats();
    await this.sock.sendMessage(numberToJid(target), {
      text: `❄️ *${this.config.botName}* is online\n\n📦 Commands: ${stats.commands}\n🗂️ Categories: ${stats.categories}\n🔰 Prefix: ${this.config.prefixes[0]}\n\nType *${this.config.prefixes[0]}menu* to begin.`,
    });
  }

  /** Request a pairing code for a phone number (digits, with country code). */
  async requestPairing(number) {
    const n = digits(number);
    if (n.length < 8 || n.length > 15) throw new Error('Enter a valid phone number with country code, digits only.');
    if (!this.sock) throw new Error('Connection is still starting. Try again in a few seconds.');
    if (this.sock.authState?.creds?.registered) throw new Error('This bot is already linked to WhatsApp.');
    if (!this.awaitingAuth) throw new Error('Not ready yet. Wait a few seconds and try again.');
    const code = await this.sock.requestPairingCode(n);
    this.pairingCode = String(code).match(/.{1,4}/g)?.join('-') || String(code);
    this.qr = null;
    this.logger.box('PAIRING CODE', [this.pairingCode, '', 'WhatsApp → Linked devices → Link with phone number']);
    return this.pairingCode;
  }

  /** Soft restart: drop the socket and open a fresh one (keeps the process alive). */
  async restart() {
    this.logger.info('Restarting connection…');
    try { this.sock?.ev.removeAllListeners(); this.sock?.ws?.close(); } catch { /* ignore */ }
    this.sock = null;
    this.stopped = false;
    await this.start();
  }

  async stop() {
    this.stopped = true;
    this.status = 'stopped';
    try { this.sock?.ev.removeAllListeners(); this.sock?.end?.(undefined); } catch { /* ignore */ }
  }
}
