// yt-dlp wrapper for YouTube / Instagram / Facebook / Twitter(X) / TikTok fallback and more.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { run, cleanup } from './utils.js';

const MEDIA_EXT = { video: ['mp4', 'webm', 'mkv', 'mov'], image: ['jpg', 'jpeg', 'png', 'webp'], audio: ['mp3', 'm4a', 'opus', 'ogg', 'wav'] };

function baseArgs() {
  const a = ['--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '20', '--max-filesize', `${config.maxMediaMB}M`];
  if (config.ytdlpCookies) a.push('--cookies', config.ytdlpCookies);
  return a;
}

function friendly(err) {
  const m = String(err?.message || err);
  if (/Sign in to confirm|not a bot/i.test(m)) return new Error('YouTube asked for verification. Set YTDLP_COOKIES (see README) and try again.');
  if (/login required|rate-limit|cookies/i.test(m)) return new Error('This site needs a login (private post or rate limit). Try a public link, or set YTDLP_COOKIES.');
  if (/Unsupported URL/i.test(m)) return new Error('That link is not supported.');
  if (/larger than max-filesize|File is larger/i.test(m)) return new Error(`The file is bigger than ${config.maxMediaMB} MB.`);
  if (/Private video|unavailable|removed/i.test(m)) return new Error('That media is private or unavailable.');
  return new Error(`Download failed: ${m.split('\n').pop().slice(0, 160)}`);
}

function findOutput(base) {
  const dir = os.tmpdir();
  const stem = path.basename(base);
  const file = fs.readdirSync(dir).find((f) => f.startsWith(`${stem}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
  return file ? path.join(dir, file) : null;
}

const newBase = () => path.join(os.tmpdir(), `freezer-dl-${crypto.randomBytes(6).toString('hex')}`);

/** Search YouTube. @returns {Promise<{id:string,title:string,url:string,duration:number,channel:string,views:number}[]>} */
export async function search(query, count = 5) {
  try {
    const { stdout } = await run('yt-dlp', [`ytsearch${count}:${query}`, '--dump-json', '--flat-playlist', '--no-warnings'], { timeout: 45000 });
    return stdout.split('\n').filter(Boolean).map((l) => {
      const j = JSON.parse(l);
      return { id: j.id, title: j.title, url: j.url || `https://www.youtube.com/watch?v=${j.id}`, duration: j.duration || 0, channel: j.channel || j.uploader || '', views: j.view_count || 0 };
    });
  } catch (err) {
    throw friendly(err);
  }
}

/** Download best audio as mp3. @returns {Promise<{buffer:Buffer,title:string}>} */
export async function downloadAudio(url) {
  const base = newBase();
  try {
    const { stdout } = await run('yt-dlp', [...baseArgs(), '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '5', '--print', '%(title)s', '--no-simulate', '-o', `${base}.%(ext)s`, url], { timeout: 240000 });
    const file = findOutput(base);
    if (!file) throw new Error('no output file');
    return { buffer: await fs.promises.readFile(file), title: stdout.trim().split('\n')[0] || 'audio' };
  } catch (err) {
    throw friendly(err);
  } finally {
    const f = findOutput(base);
    cleanup(f);
  }
}

/** Download a video/photo post. @returns {Promise<{buffer:Buffer,kind:'video'|'image'|'audio',title:string}>} */
export async function downloadMedia(url, { maxHeight = 720 } = {}) {
  const base = newBase();
  try {
    const format = `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${maxHeight}][ext=mp4]/b[height<=${maxHeight}]/b`;
    const { stdout } = await run('yt-dlp', [...baseArgs(), '-f', format, '--merge-output-format', 'mp4', '--print', '%(title)s', '--no-simulate', '-o', `${base}.%(ext)s`, url], { timeout: 300000 });
    const file = findOutput(base);
    if (!file) throw new Error('no output file');
    const ext = path.extname(file).slice(1).toLowerCase();
    const kind = Object.entries(MEDIA_EXT).find(([, exts]) => exts.includes(ext))?.[0] ?? 'video';
    return { buffer: await fs.promises.readFile(file), kind, title: stdout.trim().split('\n')[0] || '' };
  } catch (err) {
    throw friendly(err);
  } finally {
    cleanup(findOutput(base));
  }
}
