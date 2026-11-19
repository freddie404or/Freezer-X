export default {
  name: 'owner',
  category: 'general',
  description: 'Contact card of the bot owner',
  aliases: ['creator', 'dev'],
  async execute(ctx) {
    const number = ctx.config.owners[0];
    if (!number) return ctx.reply('👑 The owner number is not configured yet (set OWNER_NUMBER).');
    const name = ctx.config.ownerName;
    const vcard = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name}`, `ORG:${ctx.config.botName};`, `TEL;type=CELL;type=VOICE;waid=${number}:+${number}`, 'END:VCARD'].join('\n');
    await ctx.send({ contacts: { displayName: name, contacts: [{ vcard }] } }, { quoted: ctx.msg.raw });
  },
};
