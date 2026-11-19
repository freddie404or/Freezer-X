// Cosmetic metadata only (emoji, title, search aliases). The menu does NOT depend on this file:
// any folder/category found in plugins/ is displayed automatically, with a default look if it is
// not listed here.
export const CATEGORY_META = {
  general: { emoji: '🏠', title: 'GENERAL', aliases: ['main', 'gen', 'basic'] },
  ai: { emoji: '🤖', title: 'AI MENU', aliases: ['gpt', 'chatgpt', 'artificial'] },
  downloads: { emoji: '📥', title: 'DOWNLOADS', aliases: ['download', 'dl', 'downloader'] },
  search: { emoji: '🔎', title: 'SEARCH', aliases: ['find', 'searches'] },
  group: { emoji: '👥', title: 'GROUP', aliases: ['groups', 'grp'] },
  admin: { emoji: '🛡️', title: 'ADMIN', aliases: ['admins', 'mod', 'moderation'] },
  fun: { emoji: '🎮', title: 'FUN', aliases: ['games', 'game', 'funny'] },
  media: { emoji: '🎬', title: 'MEDIA', aliases: ['sticker', 'stickers', 'audio', 'video', 'image'] },
  owner: { emoji: '👑', title: 'OWNER', aliases: ['dev', 'creator'] },
  utility: { emoji: '🧰', title: 'UTILITY', aliases: ['utils', 'util', 'tools', 'tool'] },
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_META);

export function metaFor(category) {
  return CATEGORY_META[category] || { emoji: '📦', title: String(category).toUpperCase(), aliases: [] };
}
