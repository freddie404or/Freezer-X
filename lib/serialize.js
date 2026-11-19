// Normalises raw Baileys messages into a small, predictable shape.
import { jidToNumber } from './utils.js';

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
const MEDIA_TYPES = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker',
  documentMessage: 'document',
};

/** Unwrap ephemeral / view-once / edited wrappers. */
export function unwrap(message) {
  let m = message;
  for (let i = 0; i < 6 && m; i++) {
    let inner = null;
    for (const w of WRAPPERS) if (m[w]?.message) { inner = m[w].message; break; }
    inner ??= m.editedMessage?.message?.protocolMessage?.editedMessage ?? null;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

export function messageType(m) {
  return Object.keys(m || {}).find((k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage') || '';
}

export function messageText(m) {
  const t = messageType(m);
  const c = m?.[t];
  return (
    m?.conversation ||
    c?.text ||
    c?.caption ||
    c?.selectedDisplayText ||
    c?.selectedButtonId ||
    c?.singleSelectReply?.selectedRowId ||
    ''
  );
}

const contextOf = (m) => m?.[messageType(m)]?.contextInfo;

/**
 * @param {any} msg raw Baileys message
 * @returns serialised message or null when it should be ignored
 */
export function serialize(msg, { botIds = [] } = {}) {
  if (!msg?.message || !msg.key?.remoteJid) return null;
  const chat = msg.key.remoteJid;
  if (chat === 'status@broadcast' || chat.endsWith('@newsletter') || chat.endsWith('@broadcast')) return null;

  const message = unwrap(msg.message);
  const type = messageType(message);
  if (!type || type === 'protocolMessage' || type === 'reactionMessage' || type === 'senderKeyDistributionMessage') return null;

  const isGroup = chat.endsWith('@g.us');
  const sender = isGroup ? msg.key.participant || msg.participant || '' : msg.key.fromMe ? botIds[0] || chat : chat;
  const senderIds = [sender, msg.key.participantAlt, msg.key.participantPn, msg.key.remoteJidAlt].filter(Boolean);
  const ctxInfo = contextOf(message);
  const botNums = botIds.map(jidToNumber);

  let quoted = null;
  if (ctxInfo?.quotedMessage) {
    const qm = unwrap(ctxInfo.quotedMessage);
    const qt = messageType(qm);
    quoted = {
      key: { remoteJid: chat, id: ctxInfo.stanzaId, participant: ctxInfo.participant, fromMe: botNums.includes(jidToNumber(ctxInfo.participant)) },
      message: qm,
      type: qt,
      sender: ctxInfo.participant || '',
      text: messageText(qm),
      mediaKind: MEDIA_TYPES[qt] || null,
      mime: qm[qt]?.mimetype || '',
    };
  }

  const mentioned = ctxInfo?.mentionedJid || [];
  return {
    raw: msg,
    key: msg.key,
    id: msg.key.id,
    chat,
    isGroup,
    sender,
    senderIds,
    fromMe: Boolean(msg.key.fromMe),
    pushName: msg.pushName || '',
    type,
    message,
    body: String(messageText(message) || ''),
    mentioned,
    mediaKind: MEDIA_TYPES[type] || null,
    mime: message[type]?.mimetype || '',
    timestamp: Number(msg.messageTimestamp || 0),
    quoted,
    mentionsBot: mentioned.some((j) => botNums.includes(jidToNumber(j))),
    repliesToBot: quoted ? botNums.includes(jidToNumber(quoted.sender)) : false,
  };
}
