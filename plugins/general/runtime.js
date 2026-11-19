import os from 'node:os';
import { formatUptime } from '../../lib/utils.js';

export default {
  name: 'runtime',
  category: 'general',
  description: 'How long the bot and the server have been running',
  aliases: ['uptime'],
  async execute(ctx) {
    await ctx.reply(
      `⏱️ *Runtime*\n\n🤖 Bot: ${formatUptime((Date.now() - ctx.app.startedAt) / 1000)}\n🖥️ Server: ${formatUptime(os.uptime())}\n🟢 Process: ${formatUptime(process.uptime())}`,
    );
  },
};
