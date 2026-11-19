// Sticker creation without extra npm packages: ffmpeg makes the WebP, we inject the
// WhatsApp sticker-pack EXIF block (pack name / author) into the RIFF container ourselves.
import crypto from 'node:crypto';
import { ffmpeg, extFromMime } from './ffmpeg.js';

const PAD = 'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';
const FIT = 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos';
const FILL = 'scale=512:512:force_original_aspect_ratio=increase:flags=lanczos,crop=512:512';

export function buildExif(pack, author) {
  const json = Buffer.from(
    JSON.stringify({ 'sticker-pack-id': crypto.randomUUID(), 'sticker-pack-name': pack, 'sticker-pack-publisher': author, emojis: ['❄️'] }),
    'utf8',
  );
  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
  const exif = Buffer.concat([head, json]);
  exif.writeUInt32LE(json.length, 14);
  return exif;
}

const u24 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);

function chunk(fourcc, data) {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'ascii');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** Insert (or replace) the EXIF chunk of a WebP file. Works for static and animated stickers. */
export function addExif(webp, pack, author) {
  if (webp.length < 16 || webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Not a valid WebP image.');
  }
  const chunks = [];
  for (let off = 12; off + 8 <= webp.length;) {
    const fourcc = webp.toString('ascii', off, off + 4);
    const size = webp.readUInt32LE(off + 4);
    chunks.push({ fourcc, data: webp.subarray(off + 8, off + 8 + size) });
    off += 8 + size + (size & 1);
  }
  const vp8x = chunks.find((c) => c.fourcc === 'VP8X');
  const rest = chunks.filter((c) => c.fourcc !== 'VP8X' && c.fourcc !== 'EXIF');

  let flags = 0;
  let canvas;
  if (vp8x) {
    flags = vp8x.data[0];
    canvas = vp8x.data.subarray(4, 10);
  } else {
    const img = rest.find((c) => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L');
    if (!img) throw new Error('Unsupported WebP layout.');
    let w;
    let h;
    if (img.fourcc === 'VP8 ') {
      w = img.data.readUInt16LE(6) & 0x3fff;
      h = img.data.readUInt16LE(8) & 0x3fff;
    } else {
      const bits = img.data.readUInt32LE(1);
      w = (bits & 0x3fff) + 1;
      h = ((bits >> 14) & 0x3fff) + 1;
    }
    canvas = Buffer.concat([u24(w - 1), u24(h - 1)]);
    if (rest.some((c) => c.fourcc === 'ALPH')) flags |= 0x10;
  }
  flags |= 0x08; // EXIF present

  const body = Buffer.concat([
    chunk('VP8X', Buffer.concat([Buffer.from([flags, 0, 0, 0]), canvas])),
    ...rest.map((c) => chunk(c.fourcc, c.data)),
    chunk('EXIF', buildExif(pack, author)),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/**
 * Create a WhatsApp sticker from an image / gif / video buffer.
 * @param {Buffer} buffer
 * @param {{mime?: string, pack: string, author: string, crop?: boolean}} opts
 */
export async function makeSticker(buffer, { mime = '', pack, author, crop = false }) {
  const fit = crop ? FILL : `${FIT},${PAD}`;
  const isMotion = /video|gif/i.test(mime);
  const inExt = extFromMime(mime, isMotion ? 'mp4' : 'jpg');

  let webp;
  if (!isMotion) {
    webp = await ffmpeg(buffer, inExt, 'webp', ['-vf', `${fit},format=rgba`, '-vcodec', 'libwebp', '-lossless', '0', '-q:v', '70', '-compression_level', '6', '-frames:v', '1']);
  } else {
    // animated: retry with smaller settings until it fits WhatsApp's ~1 MB sticker limit
    for (const [fps, q] of [[15, 50], [12, 35], [10, 25]]) {
      webp = await ffmpeg(buffer, inExt, 'webp', ['-t', '8', '-vf', `fps=${fps},${fit},format=rgba`, '-vcodec', 'libwebp', '-lossless', '0', '-q:v', String(q), '-compression_level', '6', '-loop', '0', '-an']);
      if (webp.length < 950 * 1024) break;
    }
  }
  return addExif(webp, pack, author);
}
