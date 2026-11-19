// Automatic menu builder. Everything shown here is derived from the live plugin registry,
// so adding/removing a plugin file updates the menu with no manual command list.
import { metaFor } from './categories.js';
import { formatUptime } from './utils.js';

const HEAD_TOP = '╔════════◇◆◇═══════╗';
const HEAD_BOT = '╚════════◇◆◇═══════╝';
const BOX_TOP = '╔═══════════════╗';
const BOX_MID = '╠═══════════════╣';
const BOX_BOT = '╚═══════════════╝';

/** "FREEZER MD" -> "𝐅𝐑𝐄𝐄𝐙𝐄𝐑-𝐌𝐃" (mathematical bold letters/digits; spaces become hyphens). */
export function boldText(str) {
  return [...String(str)].map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ce + c - 48);
    return ch === ' ' ? '-' : ch;
  }).join('');
}

function formatDate(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  }
}

/** Latency of the message that triggered the menu (falls back to 0 when unknown). */
function pingMs(ctx) {
  const ts = Number(ctx.msg?.timestamp || 0);
  return ts ? Math.max(0, Date.now() - ts * 1000) : 0;
}

/** One menu box. rows = [[line, optionalSubline], ...] */
function box(title, rows, bullet = '➤ ') {
  const lines = [BOX_TOP, `  ${title}`, BOX_MID];
  for (const [line, sub] of rows) {
    lines.push(`║ ${bullet}${line}`);
    if (sub) lines.push(`║    └ ${sub}`);
  }
  lines.push(BOX_BOT);
  return lines.join('\n');
}

/** Strip characters that would break WhatsApp formatting or the box layout. */
const safe = (s, max = 64) => {
  const t = String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[*_~`|]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function normalise(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Find a category by name, alias or unique prefix. */
export function resolveCategory(query, categories) {
  const q = normalise(query);
  if (!q) return null;
  const names = [...categories.keys()];
  const exact = names.find((n) => normalise(n) === q || metaFor(n).aliases.some((a) => normalise(a) === q));
  if (exact) return exact;
  const prefix = names.filter((n) => normalise(n).startsWith(q) || normalise(n).startsWith(q.replace(/s$/, '')));
  return prefix.length === 1 ? prefix[0] : null;
}

function header(ctx, count) {
  const { config, app } = ctx;
  const uptime = formatUptime((Date.now() - (app?.startedAt ?? Date.now())) / 1000);
  return [
    HEAD_TOP,
    `├ ❄️🌹${boldText(safe(config.botName, 30))}🌹❄️`,
    `├▢👑 Owner: *${safe(config.ownerName, 24)}*`,
    `├▢🕐 Date: *${formatDate(config.timezone)}*`,
    `├▢⏱️ Uptime: *${uptime}*`,
    `├▢📶 Ping: *${pingMs(ctx)}ms*`,
    `├▢🔖 Version: *v${config.version}*`,
    `├▢📚 Commands: *${count}*`,
    HEAD_BOT,
  ].join('\n');
}

/**
 * Build the menu.
 * @returns {{header:string, sections:string[], footer:string, count:number, error?:string}}
 */
export function buildMenu(ctx, { query = '' } = {}) {
  const { registry, prefix } = ctx;
  const categories = registry.byCategory();
  const count = [...categories.values()].reduce((n, a) => n + a.length, 0);

  if (count === 0) return { error: '⚠️ No commands are loaded right now.', header: '', sections: [], footer: '', count: 0 };

  // ".menu <command>" -> detailed help for that command.
  if (query) {
    const cat = resolveCategory(query, categories);
    if (!cat) {
      const plugin = registry.get(query.replace(prefix, ''));
      if (plugin && !plugin.hidden) return commandHelp(ctx, plugin);
      const names = [...categories.keys()].map((c) => `• ${c}`).join('\n');
      return { error: `❌ No category or command named *${safe(query, 30)}*.\n\n*Categories*\n${names}`, header: '', sections: [], footer: '', count };
    }
    const meta = metaFor(cat);
    const plugins = categories.get(cat);
    const rows = plugins.map((p) => [`${prefix}${p.name}${p.usage ? ` ${safe(p.usage, 30)}` : ''}`, safe(p.description)]);
    return {
      header: header(ctx, plugins.length),
      sections: [box(`${meta.emoji} *${meta.title}*`, rows)],
      footer: `_${prefix}menu <command> for details_`,
      count: plugins.length,
    };
  }

  const sections = [];
  for (const [cat, plugins] of categories) {
    const meta = metaFor(cat);
    sections.push(box(`${meta.emoji} *${meta.title}*`, plugins.map((p) => [`${prefix}${p.name}`])));
  }
  return {
    header: header(ctx, count),
    sections,
    footer: `_${prefix}menu <category> • ${prefix}menu <command>_`,
    count,
  };
}

function commandHelp(ctx, p) {
  const { prefix } = ctx;
  const meta = metaFor(p.category);
  const rows = [
    [`📝 ${safe(p.description, 120)}`],
    [`🗂️ Category: ${meta.title}`],
  ];
  if (p.aliases.length) rows.push([`🔁 Aliases: ${p.aliases.map((a) => prefix + a).join(', ')}`]);
  rows.push([`📌 Usage: ${prefix}${p.name}${p.usage ? ` ${safe(p.usage, 60)}` : ''}`]);
  const flags = [p.ownerOnly && 'owner', p.adminOnly && 'group admins', p.groupOnly && 'groups only'].filter(Boolean);
  if (flags.length) rows.push([`🔒 Restricted: ${flags.join(', ')}`]);
  return { header: '', sections: [box(`${meta.emoji} *${prefix}${safe(p.name, 30)}*`, rows, '')], footer: '', count: 1 };
}

/**
 * Join header + sections + footer into messages that stay below WhatsApp's practical size limit,
 * never splitting a category box in half.
 * @param {{header:string,sections:string[],footer:string}} out
 * @param {{withImage?: boolean, limit?: number}} opts
 * @returns {{caption: string|null, texts: string[]}}
 */
export function pack(out, { withImage = false, limit = 3500 } = {}) {
  const blocks = [...out.sections];
  if (out.footer) blocks.push(out.footer);
  const texts = [];
  let current = withImage || !out.header ? '' : out.header;
  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > limit && current) {
      texts.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) texts.push(current);
  return { caption: withImage ? out.header || null : null, texts };
}
