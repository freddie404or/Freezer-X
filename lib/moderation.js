// Shared helpers for group moderation plugins (anti-link, anti-badword, warn).
export const MAX_WARNS = 3;
export const LINK_RE = /(?:https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+|wa\.me\/\S+/i;

export const DEFAULT_BADWORDS = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dickhead', 'motherfucker', 'cunt'];

export function containsBadWord(text, extra = []) {
  const words = [...DEFAULT_BADWORDS, ...extra].map((w) => w.toLowerCase());
  const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.find((w) => tokens.includes(w)) ?? null;
}

export function addWarn(db, chat, number) {
  const g = db.group(chat);
  g.warns[number] = (g.warns[number] || 0) + 1;
  db.save();
  return g.warns[number];
}

export function clearWarns(db, chat, number) {
  delete db.group(chat).warns[number];
  db.save();
}
