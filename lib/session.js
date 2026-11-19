// Session loader: restores session/creds.json from a self-contained SESSION_ID.
//
// Format: SESSION_ID = "<PREFIX>~<base64(payload)>"
// Recognised prefixes (stripped before decoding, case-insensitive):
//   "FREEZER~"  -> base64(zip archive containing creds.json)   [current]
//   "POPKID~"   -> base64(zip archive containing creds.json)   [legacy]
//   "F~"        -> base64(gzip(creds.json))                    [legacy]
//   "SILA-MD~"  -> base64(gzip(creds.json))                    [legacy]
//   "NEXUS___"  -> base64(gzip(creds.json))                    [legacy]
// Older FREEZER strings (plain base64 of creds.json, optional "FREEZER-"/"FREEZER_"/"FREEZER:" prefix)
// are still accepted.
//
// The payload type (zip / gzip / raw JSON) is auto-detected after base64 decoding.
// No network call and no zip library: only single-entry, non-streamed zips are handled
// (method STORE or DEFLATE), which is what session generators produce.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const CURRENT_PREFIX = 'FREEZER~';
const KNOWN_PREFIXES = [CURRENT_PREFIX, 'POPKID~', 'F~', 'SILA-MD~', 'NEXUS___'];
const OLD_FREEZER_RE = /^FREEZER[-_:]?/i;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const LOCAL_HEADER_SIZE = 30;

/** Strips any recognised branding prefix from the raw SESSION_ID. */
export function stripPrefix(raw) {
  let value = String(raw).trim();
  const upper = value.toUpperCase();
  const hit = KNOWN_PREFIXES.find((p) => upper.startsWith(p));
  if (hit) return value.slice(hit.length).trim();
  return value.replace(OLD_FREEZER_RE, '').trim();
}

/** Extracts a named entry from a zip buffer by walking its local file headers. */
export function extractFromZip(buffer, targetName = 'creds.json') {
  let offset = 0;
  while (offset + LOCAL_HEADER_SIZE <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);

    if (flags & 0x0008) throw new Error('zip entry uses a streamed data descriptor, which is not supported');

    const nameStart = offset + LOCAL_HEADER_SIZE;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('zip entry data runs past end of buffer (truncated session string?)');

    if (name === targetName) {
      const comp = buffer.subarray(dataStart, dataEnd);
      if (method === 0) return comp;
      if (method === 8) {
        const inflated = zlib.inflateRawSync(comp);
        if (inflated.length !== uncompressedSize) throw new Error('inflated size mismatch - data may be corrupt');
        return inflated;
      }
      throw new Error(`unsupported zip compression method (${method})`);
    }
    offset = dataEnd;
  }
  throw new Error(`zip archive does not contain a "${targetName}" entry`);
}

/**
 * Normalises base64: strips whitespace / zero-width chars chat apps inject, accepts the
 * URL-safe alphabet and the '*' variant of '/', and restores missing '=' padding.
 */
export function normalizeBase64(str) {
  let value = str.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  value = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\*/g, '/');
  const rem = value.length % 4;
  if (rem === 2) value += '==';
  else if (rem === 3) value += '=';
  else if (rem === 1) throw new Error('base64 length is invalid (string is truncated or corrupted)');
  return value;
}

/** Decodes a SESSION_ID into a raw creds.json buffer. Returns {ok:true,data} or {ok:false,reason}. */
export function decodeSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
    return { ok: false, reason: 'SESSION_ID is empty' };
  }
  const body = stripPrefix(sessionId);
  if (!body) return { ok: false, reason: 'SESSION_ID is empty after stripping prefix' };

  let payload;
  try {
    payload = Buffer.from(normalizeBase64(body), 'base64');
    if (!payload.length) throw new Error('decoded buffer is empty');
  } catch (e) {
    return { ok: false, reason: e.message.startsWith('base64') ? e.message : `invalid base64: ${e.message}` };
  }

  let creds;
  try {
    if (payload.subarray(0, 4).equals(ZIP_MAGIC)) creds = extractFromZip(payload, 'creds.json');
    else if (payload.subarray(0, 2).equals(GZIP_MAGIC)) creds = zlib.gunzipSync(payload);
    else creds = payload; // plain base64 of creds.json (older FREEZER format)
  } catch (e) {
    return { ok: false, reason: `failed to unpack payload: ${e.message}` };
  }

  try {
    JSON.parse(creds.toString('utf8'));
  } catch (e) {
    return { ok: false, reason: `decoded data is not valid JSON: ${e.message}` };
  }
  return { ok: true, data: creds };
}

/** Writes via temp file + rename so a crash never leaves a half-written creds.json. */
async function atomicWrite(file, data) {
  const tmp = path.join(path.dirname(file), `.creds.${crypto.randomBytes(6).toString('hex')}.tmp`);
  await fs.promises.writeFile(tmp, data, { mode: 0o600 });
  await fs.promises.rename(tmp, file);
}

/**
 * Restores creds.json from sessionId into sessionDir (skips if it already exists).
 * Returns true when a usable session is present afterwards.
 */
export async function loadSession(sessionId, sessionDir, logger = console) {
  const log = (level, msg) => (logger[level] || logger.log || console.log).call(logger, msg);
  const credsPath = path.join(sessionDir, 'creds.json');

  if (fs.existsSync(credsPath)) {
    log('info', 'Session already exists, skipping extraction.');
    return true;
  }
  if (!sessionId || !sessionId.trim()) return false; // nothing to restore: QR / pairing-code flow

  try {
    await fs.promises.mkdir(sessionDir, { recursive: true });
  } catch (e) {
    log('error', `Could not create session directory: ${e.message}`);
    return false;
  }

  const result = decodeSessionId(sessionId);
  if (!result.ok) {
    log('error', `Failed to extract session: ${result.reason}`);
    log('warn', 'Make sure you copied the FULL session string.');
    return false;
  }
  try {
    await atomicWrite(credsPath, result.data);
    log('ok', `Session restored from SESSION_ID (${result.data.length} bytes)`);
    return true;
  } catch (e) {
    log('error', `Failed to write creds.json: ${e.message}`);
    return false;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Encodes creds.json into a SESSION_ID (single-entry STORE zip, base64url). */
export function encodeSessionId(credsData, prefix = CURRENT_PREFIX) {
  const buf = Buffer.isBuffer(credsData) ? credsData : Buffer.from(credsData);
  const name = Buffer.from('creds.json', 'utf8');
  const crc = crc32(buf);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(buf.length, 18);
  local.writeUInt32LE(buf.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(buf.length, 20);
  central.writeUInt32LE(buf.length, 24);
  central.writeUInt16LE(name.length, 28);

  const localEntry = Buffer.concat([local, name, buf]);
  const centralEntry = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);

  return `${prefix}${Buffer.concat([localEntry, centralEntry, eocd]).toString('base64url')}`;
}
