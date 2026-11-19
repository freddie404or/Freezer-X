// Run with: npm test   (no WhatsApp connection or npm install required)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { Database } from '../lib/db.js';
import { PluginRegistry } from '../lib/loader.js';
import { Handler } from '../lib/handler.js';
import { buildMenu, pack } from '../lib/menu.js';
import { evaluate } from '../lib/calc.js';
import { hasBin } from '../lib/utils.js';
import zlib from 'node:zlib';
import { decodeSessionId, encodeSessionId, loadSession } from '../lib/session.js';

const quiet = { info() {}, ok() {}, warn() {}, error() {}, box() {} };
config.cooldownMs = 0;
config.autoTyping = false;
config.owners = ['254700000001'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freezer-test-'));

function mockSock() {
  const sent = [];
  return {
    sent,
    user: { id: '254799999999:5@s.whatsapp.net' },
    sendMessage: async (jid, content, opts) => { sent.push({ jid, content, opts }); return {}; },
    sendPresenceUpdate: async () => {},
    readMessages: async () => {},
    groupMetadata: async () => { throw new Error('no groups in tests'); },
  };
}

async function setup(dir = config.pluginsDir) {
  const db = new Database(path.join(tmp, `db-${Math.random()}.json`));
  const registry = new PluginRegistry({ dir, logger: quiet, getDisabled: () => db.data.disabledPlugins });
  await registry.load();
  const app = { startedAt: Date.now() - 65_000, restart: async () => {}, shutdown: async () => {} };
  const handler = new Handler({ config, db, registry, logger: quiet, app });
  const sock = mockSock();
  handler.attach(sock);
  let n = 0;
  const say = async (text, { from = '254711111111', chat } = {}) => {
    const before = sock.sent.length;
    const jid = `${from}@s.whatsapp.net`;
    await handler.onMessages({
      type: 'notify',
      messages: [{ key: { remoteJid: chat || jid, id: `T${Date.now()}${n++}`, fromMe: false }, message: { conversation: text }, pushName: 'Tester', messageTimestamp: Math.floor(Date.now() / 1000) }],
    });
    return sock.sent.slice(before);
  };
  return { db, registry, handler, sock, say, app };
}

const textOf = (sent) => sent.map((s) => s.content.text ?? s.content.caption ?? '').join('\n');
const ctxFor = (s) => ({ registry: s.registry, config, db: s.db, app: s.app, prefix: '.', pushName: 'Tester' });

test('all bundled plugins load with no broken, invalid or duplicate entries', async () => {
  const { registry } = await setup();
  const hard = registry.problems.filter((p) => ['broken', 'invalid', 'duplicate'].includes(p.kind));
  assert.deepEqual(hard, []);
  assert.ok(registry.stats().commands >= 80, `expected 80+ commands, got ${registry.stats().commands}`);
  assert.equal(registry.byCategory().size, 10);
});

test('loader isolates broken plugins and rejects duplicates', async () => {
  const dir = path.join(tmp, 'plugins-a');
  fs.mkdirSync(path.join(dir, 'fun'), { recursive: true });
  const w = (f, c) => fs.writeFileSync(path.join(dir, f), c);
  w('fun/a_good.js', `export default { name:'good', description:'ok', aliases:['g1'], execute: async (c)=>c.reply('hi') }`);
  w('fun/dupname.js', `export default { name:'good', description:'dup', execute: async()=>{} }`);
  w('fun/dupalias.js', `export default { name:'other', description:'dup alias', aliases:['g1'], execute: async()=>{} }`);
  w('fun/syntax.js', `export default { name: 'x', `);
  w('fun/invalid.js', `export default { name:'Bad Name', description:'x', execute(){} }`);
  w('fun/noexec.js', `export default { name:'noexec', description:'x' }`);
  w('fun/needs.js', `export default { name:'needs', description:'x', requires:{bin:['definitely-not-installed-bin']}, execute(){} }`);
  const { registry } = await setup(dir);
  assert.deepEqual([...registry.plugins.keys()], ['good']);
  const kinds = Object.fromEntries(registry.problems.map((p) => [p.file, p.kind]));
  assert.equal(kinds['fun/dupname.js'], 'duplicate');
  assert.equal(kinds['fun/dupalias.js'], 'duplicate');
  assert.equal(kinds['fun/syntax.js'], 'broken');
  assert.equal(kinds['fun/invalid.js'], 'invalid');
  assert.equal(kinds['fun/noexec.js'], 'invalid');
  assert.equal(kinds['fun/needs.js'], 'unavailable');
});

test('full menu lists every visible command exactly once with the correct count', async () => {
  const s = await setup();
  const out = buildMenu(ctxFor(s));
  const all = out.sections.join('\n');
  const names = [...all.matchAll(/^║ ➤ \.(\S+)/gm)].map((m) => m[1]);
  const expected = [...s.registry.byCategory().values()].flat().map((p) => p.name);
  assert.equal(names.length, new Set(names).size, 'no duplicate lines');
  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.match(out.header, new RegExp(`Commands: \\*${expected.length}\\*`));
  assert.equal(out.count, expected.length);
});

test('menu never shows unavailable commands', async () => {
  const s = await setup();
  const all = buildMenu(ctxFor(s)).sections.join('\n');
  if (!hasBin('yt-dlp')) for (const hidden of ['.ytmp3', '.ytmp4', '.play', '.instagram', '.yts']) assert.ok(!all.includes(`${hidden}\n`), `${hidden} should be hidden`);
});

test('category menus: .menu admin / .menu downloads / aliases', async () => {
  const s = await setup();
  const admin = buildMenu(ctxFor(s), { query: 'admin' });
  assert.match(admin.sections[0], /ADMIN/);
  assert.match(admin.header, /^╔════════◇◆◇═══════╗\n├ ❄️🌹𝐅𝐑𝐄𝐄𝐙𝐄𝐑-𝐌𝐃🌹❄️\n├▢👑 Owner: \*[^\n]+\*\n├▢🕐 Date: \*\d\d\/\d\d\/\d{4}\*\n├▢⏱️ Uptime: \*[^\n]+\*\n├▢📶 Ping: \*\d+ms\*\n├▢🔖 Version: \*v[\d.]+\*\n├▢📚 Commands: \*\d+\*\n╚════════◇◆◇═══════╝$/);
  assert.ok(admin.sections[0].includes('.kick') && admin.sections[0].includes('.warn'));
  assert.ok(!admin.sections[0].includes('.ping'));
  assert.equal(buildMenu(ctxFor(s), { query: 'dl' }).sections[0].includes('DOWNLOADS'), true);
  assert.equal(buildMenu(ctxFor(s), { query: 'games' }).sections[0].includes('FUN'), true);
  assert.ok(buildMenu(ctxFor(s), { query: 'nonsense' }).error);
  assert.match(buildMenu(ctxFor(s), { query: 'ping' }).sections[0], /Aliases/);
});

test('menu chunks stay under the size limit and never split a box', async () => {
  const s = await setup();
  const { texts } = pack(buildMenu(ctxFor(s)), { limit: 900 });
  assert.ok(texts.length > 1);
  for (const t of texts) {
    assert.ok(t.length <= 1400, 'chunk too big');
    const opens = (t.match(/^╔/gm) || []).length;
    const closes = (t.match(/^╚/gm) || []).length;
    assert.equal(opens, closes, 'unbalanced box');
  }
});

test('a newly added plugin / category appears in the menu with no manual list', async () => {
  const dir = path.join(tmp, 'plugins-b');
  fs.mkdirSync(path.join(dir, 'newcat'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'newcat', 'zed.js'), `export default { name:'zed', description:'A brand new command', execute: async(c)=>c.reply('zed!') }`);
  const s = await setup(dir);
  assert.ok(buildMenu(ctxFor(s)).sections.join('\n').includes('NEWCAT'));
  fs.writeFileSync(path.join(dir, 'newcat', 'zoe.js'), `export default { name:'zoe', description:'Another', execute: async(c)=>c.reply('zoe!') }`);
  await s.registry.load();
  assert.ok(buildMenu(ctxFor(s)).sections.join('\n').includes('.zoe'));
});

test('commands and aliases execute through the handler', async () => {
  const s = await setup();
  assert.match(textOf(await s.say('.ping')), /Pong/);
  assert.match(textOf(await s.say('.p')), /Pong/, 'alias .p');
  assert.match(textOf(await s.say('.speed')), /Pong/, 'alias .speed');
  assert.match(textOf(await s.say('.calc 2*(3+4)^2')), /98/);
  assert.match(textOf(await s.say('.PING')), /Pong/, 'case-insensitive');
  assert.match(textOf(await s.say('.help')), /𝐅𝐑𝐄𝐄𝐙𝐄𝐑-𝐌𝐃/);
  assert.equal((await s.say('ping')).length, 0, 'no prefix -> ignored');
  assert.equal((await s.say('.doesnotexist')).length, 0, 'unknown -> ignored');
  assert.match(textOf(await s.say('.8ball will it work?')), /8ball|will it work/i);
  assert.match(textOf(await s.say('.dice 2d6')), /2d6/);
});

test('permissions: owner-only, group-only, private mode', async () => {
  const s = await setup();
  assert.match(textOf(await s.say('.restart')), /owner only/i);
  assert.match(textOf(await s.say('.kick @x')), /groups?|group/i);
  assert.match(textOf(await s.say('.mode private', { from: '254700000001' })), /private/);
  assert.equal((await s.say('.ping')).length, 0, 'private mode ignores non-owner');
  assert.match(textOf(await s.say('.ping', { from: '254700000001' })), /Pong/);
});

test('plugin errors are reported to the user and do not crash the handler', async () => {
  const dir = path.join(tmp, 'plugins-c');
  fs.mkdirSync(path.join(dir, 'fun'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fun', 'boom.js'), `export default { name:'boom', description:'x', execute: async()=>{ throw new Error('kaboom') } }`);
  fs.writeFileSync(path.join(dir, 'fun', 'ok.js'), `export default { name:'ok', description:'x', execute: async(c)=>c.reply('fine') }`);
  const s = await setup(dir);
  assert.match(textOf(await s.say('.boom')), /kaboom/);
  assert.match(textOf(await s.say('.ok')), /fine/);
});

test('plugin disable/enable hides commands from menu and dispatch', async () => {
  const s = await setup();
  const owner = '254700000001';
  await s.say('.plugin disable joke', { from: owner });
  assert.ok(!buildMenu(ctxFor(s)).sections.join('\n').includes('.joke\n'));
  assert.equal((await s.say('.joke')).length, 0);
  await s.say('.plugin enable joke', { from: owner });
  assert.ok(buildMenu(ctxFor(s)).sections.join('\n').includes('.joke'));
});

test('calculator is correct and safe', () => {
  assert.equal(evaluate('2+3*4'), 14);
  assert.equal(evaluate('(2+3)*4'), 20);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('-3+5'), 2);
  assert.equal(evaluate('10%4'), 2);
  assert.equal(evaluate('sqrt(16)+2pi'), 4 + 2 * Math.PI);
  assert.throws(() => evaluate('1/0'), /zero/i);
  assert.throws(() => evaluate('process.exit()'), /Unknown|Unexpected/);
  assert.throws(() => evaluate('require("fs")'), /Unknown|Unexpected/);
});

test('sticker maker produces a valid WebP with pack metadata', { skip: !hasBin('ffmpeg') }, async () => {
  const { makeSticker } = await import('../lib/sticker.js');
  const { run } = await import('../lib/utils.js');
  const png = path.join(tmp, 'in.png');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=300x200:rate=1', '-frames:v', '1', png]);
  const webp = await makeSticker(fs.readFileSync(png), { mime: 'image/png', pack: 'FREEZER TEST', author: 'QA' });
  assert.equal(webp.toString('ascii', 0, 4), 'RIFF');
  assert.equal(webp.toString('ascii', 8, 12), 'WEBP');
  assert.equal(webp.readUInt32LE(4) + 8, webp.length, 'RIFF size matches');
  assert.ok(webp.includes(Buffer.from('FREEZER TEST')), 'pack name embedded');
  assert.ok(webp.includes(Buffer.from('EXIF')));
  assert.ok(webp.length < 100 * 1024);
});

test('session ids: FREEZER~ round-trips and legacy prefixes/formats still decode', async () => {
  const creds = JSON.stringify({ noiseKey: { private: 'abc+/=' }, registered: true });
  const id = encodeSessionId(creds);
  assert.ok(id.startsWith('FREEZER~'));
  assert.equal(decodeSessionId(id).data.toString(), creds);
  assert.equal(decodeSessionId(id.replace('FREEZER~', 'POPKID~')).data.toString(), creds);
  assert.equal(decodeSessionId(` ${id.slice(0, 20)}\n${id.slice(20)} `).data.toString(), creds);
  const gz = zlib.gzipSync(creds).toString('base64');
  for (const p of ['F~', 'SILA-MD~', 'NEXUS___', 'FREEZER~']) assert.equal(decodeSessionId(p + gz).data.toString(), creds);
  assert.equal(decodeSessionId(Buffer.from(creds).toString('base64')).data.toString(), creds); // old plain format
  assert.equal(decodeSessionId('FREEZER_' + Buffer.from(creds).toString('base64')).data.toString(), creds);
  assert.equal(decodeSessionId('FREEZER~').ok, false);
  assert.equal(decodeSessionId(id.slice(0, 60)).ok, false); // truncated mid-data

  const dir = path.join(tmp, 'sess');
  assert.equal(await loadSession(id, dir, quiet), true);
  assert.equal(fs.readFileSync(path.join(dir, 'creds.json'), 'utf8'), creds);
  assert.equal(await loadSession('garbage', path.join(tmp, 'sess2'), quiet), false);
});
