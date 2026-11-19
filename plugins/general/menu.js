import fs from 'node:fs';
import { buildMenu, pack } from '../../lib/menu.js';

function loadImage(src) {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  try { return fs.existsSync(src) ? fs.readFileSync(src) : null; } catch { return null; }
}

export default {
  name: 'menu',
  category: 'general',
  description: 'Show every command, one category, or help for a command',
  aliases: ['help', 'commands', 'cmds', 'list'],
  usage: '[category|command]',
  async execute(ctx) {
    const out = buildMenu(ctx, { query: ctx.args[0] || '' });
    if (out.error) return ctx.reply(out.error);

    const image = out.header ? loadImage(ctx.config.menuImage) : null;
    const { caption, texts } = pack(out, { withImage: Boolean(image) });

    if (image) {
      try {
        await ctx.sendImage(image, caption || '');
      } catch {
        // image failed (bad URL, too large...) -> fall back to plain text with the header included
        const fallback = pack(out, { withImage: false });
        for (const t of fallback.texts) await ctx.reply(t);
        return;
      }
    }
    for (const text of texts) await ctx.reply(text);
  },
};
