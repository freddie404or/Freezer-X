import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const digits = (s) => String(s ?? '').replace(/\D/g, '');

export function formatUptime(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

export function formatBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** "254712345678:12@s.whatsapp.net" -> "254712345678" */
export function jidToNumber(jid) {
  return String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
}
export const numberToJid = (n) => `${digits(n)}@s.whatsapp.net`;

export function extractUrls(text) {
  return [...String(text ?? '').matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0]);
}

export const oneLine = (s, max = 80) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
export const truncate = (s, max) => (String(s).length > max ? `${String(s).slice(0, max - 1)}…` : String(s));

export function tmpFile(ext = 'tmp') {
  return path.join(os.tmpdir(), `freezer-${crypto.randomBytes(6).toString('hex')}.${ext}`);
}
export function cleanup(...files) {
  for (const f of files) if (f) fs.promises.rm(f, { force: true }).catch(() => {});
}

const binCache = new Map();
/** Is an executable available on PATH? (cached) */
export function hasBin(name) {
  if (!binCache.has(name)) {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' });
    binCache.set(name, probe.status === 0);
  }
  return binCache.get(name);
}

/** Run a command, resolve with {stdout, stderr}; reject with a readable error on failure/timeout. */
export function run(cmd, args = [], { timeout = 120000, maxBuffer = 50 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }
    const out = [];
    const err = [];
    let size = 0;
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`${cmd} timed out`));
    }, timeout);
    p.stdout.on('data', (d) => { size += d.length; if (size <= maxBuffer) out.push(d); });
    p.stderr.on('data', (d) => { err.push(d); if (err.length > 100) err.shift(); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString();
      const stderr = Buffer.concat(err).toString();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-300).trim()}`));
    });
  });
}
