// Shared "download this link and send it" flow used by the downloader plugins.
import { downloadMedia } from './ytdlp.js';
import { config } from '../config.js';
import { formatBytes } from './utils.js';

export async function sendFromUrl(ctx, url, { label = 'media' } = {}) {
  if (!/^https?:\/\//i.test(url || '')) return ctx.usage();
  await ctx.react('⏳');
  const media = await downloadMedia(url);
  if (media.buffer.length > config.maxMediaMB * 1024 * 1024) throw new Error(`File is too large (${formatBytes(media.buffer.length)}).`);
  const caption = `❄️ *${config.botName}*\n${media.title ? `📌 ${media.title.slice(0, 120)}\n` : ''}📦 ${formatBytes(media.buffer.length)}`;
  if (media.kind === 'image') await ctx.sendImage(media.buffer, caption);
  else if (media.kind === 'audio') await ctx.sendAudio(media.buffer);
  else await ctx.sendVideo(media.buffer, caption);
  await ctx.react('✅');
  return label;
}
