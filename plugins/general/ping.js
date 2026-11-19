export default {
  name: 'ping',
  category: 'general',
  description: 'Check bot response speed',
  aliases: ['speed', 'p'],
  async execute(ctx) {
    const sent = ctx.msg.timestamp ? ctx.msg.timestamp * 1000 : Date.now();
    const latency = Math.max(0, Date.now() - sent);
    await ctx.reply(`🏓 *Pong!*\n⚡ Latency: *${latency} ms*\n❄️ ${ctx.config.botName} is up and running.`);
  },
};
