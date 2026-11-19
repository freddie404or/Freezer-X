import os from 'node:os';
import { formatBytes, formatUptime } from '../../lib/utils.js';

export default {
  name: 'info',
  category: 'general',
  description: 'Bot and server information',
  aliases: ['botinfo', 'about'],
  async execute(ctx) {
    const s = ctx.registry.stats();
    const mem = process.memoryUsage();
    await ctx.reply(
      [
        `❄️ *${ctx.config.botName}* v${ctx.config.version}`,
        '',
        `📦 Commands: ${s.commands} (${s.aliases} names with aliases)`,
        `🗂️ Categories: ${s.categories}`,
        `⚠️ Skipped plugins: ${s.problems}`,
        `⏱️ Uptime: ${formatUptime((Date.now() - ctx.app.startedAt) / 1000)}`,
        '',
        `🟢 Node: ${process.version}`,
        `🖥️ Platform: ${os.platform()} ${os.arch()}`,
        `🧠 Memory: ${formatBytes(mem.rss)} used`,
        `🔰 Prefix: ${ctx.prefix}`,
        `👑 Owner: ${ctx.config.ownerName}`,
      ].join('\n'),
    );
  },
};
