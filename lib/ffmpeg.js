import fs from 'node:fs';
import { run, tmpFile, cleanup } from './utils.js';

/**
 * Convert a buffer with ffmpeg.
 * @param {Buffer} buffer input bytes
 * @param {string} inExt input extension (helps ffmpeg detect the format)
 * @param {string} outExt output extension
 * @param {string[]} args ffmpeg output options (placed before the output file)
 */
export async function ffmpeg(buffer, inExt, outExt, args = [], { timeout = 180000 } = {}) {
  const input = tmpFile(inExt);
  const output = tmpFile(outExt);
  await fs.promises.writeFile(input, buffer);
  try {
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...args, output], { timeout });
    return await fs.promises.readFile(output);
  } finally {
    cleanup(input, output);
  }
}

export const extFromMime = (mime, fallback = 'bin') => {
  const m = String(mime || '').split(';')[0].trim();
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/aac': 'aac', 'audio/webm': 'webm',
  };
  return map[m] || fallback;
};
