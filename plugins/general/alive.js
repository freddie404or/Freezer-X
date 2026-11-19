import { formatUptime } from '../../lib/utils.js';

export default {
  name: 'alive',
  category: 'general',
  description: 'Show that the bot is online with a quick status card',
  aliases: ['online', 'status'],
  async execute(ctx) {
    const s = ctx.registry.stats();
    const mode = ctx.db.data.settings.mode || ctx.config.mode;
    await ctx.reply(
      [
        '╭━━━━━━━━━━━━━━━━━━━━━━╮',
        `┃ ❄️ *${ctx.config.botName}* is alive`,
        '╰━━━━━━━━━━━━━━━━━━━━━━╯',
        `⏱️ Uptime: ${formatUptime((Date.now() - ctx.app.startedAt) / 1000)}`,
        `🌐 Mode: ${mode}`,
        `📦 Commands: ${s.commands}`,
        `🔰 Prefix: ${ctx.prefix}`,
        '',
        `Type *${ctx.prefix}menu* to explore.`,
      ].join('\n'),
    );
  },
};
