// FREEZER MD - central configuration. Values come from environment variables
// or a local `.env` file (see .env.example). No secrets are ever hard-coded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Tiny .env loader (no dependency). Real environment variables win.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = (m[2] ?? '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(path.join(ROOT, '.env'));

const env = process.env;
const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const digits = (s) => String(s ?? '').replace(/\D/g, '');

const defaultMenuImage = path.join(ROOT, 'assets', 'menu.jpg');

export const config = {
  botName: env.BOT_NAME || 'FREEZER MD',
  version: '1.0.0',
  prefixes: list(env.PREFIX || '.'),
  owners: list(env.OWNER_NUMBER).map(digits).filter(Boolean),
  ownerName: env.OWNER_NAME || 'FREEZER',
  mode: /^private$/i.test(env.MODE || '') ? 'private' : 'public',
  timezone: env.TZ || 'UTC',

  port: Number(env.PORT || 3000),
  webKey: env.WEB_KEY || '',
  pairingNumber: digits(env.PAIRING_NUMBER),
  sessionDir: path.resolve(ROOT, env.SESSION_DIR || 'session'),
  sessionId: env.SESSION_ID || '',

  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  pluginsDir: path.join(ROOT, 'plugins'),

  // Optional menu image: a local path (assets/menu.jpg is picked up automatically) or an https URL.
  menuImage: env.MENU_IMAGE || (fs.existsSync(defaultMenuImage) ? defaultMenuImage : ''),

  stickerPack: env.STICKER_PACK || 'FREEZER MD',
  stickerAuthor: env.STICKER_AUTHOR || 'Made with ❄️',

  autoRead: bool(env.AUTO_READ, false),
  autoTyping: bool(env.AUTO_TYPING, true),
  notifyOwnerOnStart: bool(env.NOTIFY_OWNER, true),
  cooldownMs: Number(env.COOLDOWN_MS || 1200),

  // Optional API keys. Everything works without them using free fallbacks where possible.
  openai: {
    key: env.OPENAI_API_KEY || '',
    baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    imageModel: env.OPENAI_IMAGE_MODEL || 'dall-e-3',
  },
  google: { key: env.GOOGLE_API_KEY || '', cx: env.GOOGLE_CX || '' },
  ytdlpCookies: env.YTDLP_COOKIES || '',
  maxMediaMB: Number(env.MAX_MEDIA_MB || 60),
};

export default config;
