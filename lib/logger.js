// Terminal branding + leveled logging for FREEZER MD (no dependencies).
const tty = Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR);
const esc = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const rgb = (r, g, b, s) => (tty ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m` : String(s));

export const paint = {
  bold: (s) => esc('1', s),
  dim: (s) => esc('2', s),
  red: (s) => esc('31', s),
  green: (s) => esc('32', s),
  yellow: (s) => esc('33', s),
  cyan: (s) => esc('36', s),
  ice: (s) => rgb(130, 220, 255, s),
};

function gradient(line, from = [140, 235, 255], to = [110, 120, 255]) {
  if (!tty) return line;
  const chars = [...line];
  return chars
    .map((ch, i) => {
      const t = chars.length > 1 ? i / (chars.length - 1) : 0;
      const c = from.map((f, k) => Math.round(f + (to[k] - f) * t));
      return ch === ' ' ? ch : rgb(c[0], c[1], c[2], ch);
    })
    .join('');
}

const FONT = {
  F: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '██║     ', '╚═╝     '],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  Z: ['███████╗', '╚══███╔╝', '  ███╔╝ ', ' ███╔╝  ', '███████╗', '╚══════╝'],
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  ' ': ['   ', '   ', '   ', '   ', '   ', '   '],
};

function bigText(word) {
  return Array.from({ length: 6 }, (_, row) => [...word].map((ch) => FONT[ch][row]).join(''));
}

export function banner({ name = 'FREEZER MD', version = '1.0.0' } = {}) {
  const cols = process.stdout.columns || 100;
  const lines = [''];
  const art = bigText('FREEZER MD');
  if (cols >= art[0].length + 2) {
    for (const l of art) lines.push(`  ${gradient(l)}`);
  } else {
    lines.push(`  ${gradient(`❄  F R E E Z E R   M D  ❄`)}`);
  }
  lines.push('');
  lines.push(`  ${paint.ice('❄')} ${paint.bold(name)} ${paint.dim(`v${version}`)}  ${paint.dim('•  premium multifunctional WhatsApp bot')}`);
  lines.push(`  ${paint.dim('─'.repeat(Math.min(cols - 4, 64)))}`);
  console.log(lines.join('\n'));
}

const stamp = () => new Date().toISOString().slice(11, 19);
const tag = (icon, color, label) => `${paint.dim(stamp())} ${color(`${icon} ${label.padEnd(5)}`)}`;

export const logger = {
  info: (...a) => console.log(tag('ℹ', paint.cyan, 'info'), ...a),
  ok: (...a) => console.log(tag('✔', paint.green, 'ok'), ...a),
  warn: (...a) => console.warn(tag('⚠', paint.yellow, 'warn'), ...a),
  error: (...a) => console.error(tag('✖', paint.red, 'error'), ...a),
  box(title, rows) {
    const width = Math.max(title.length, ...rows.map((r) => String(r).length)) + 4;
    const bar = '─'.repeat(width);
    console.log(paint.ice(`  ╭${bar}╮`));
    console.log(`${paint.ice('  │')} ${paint.bold(title.padEnd(width - 1))}${paint.ice('│')}`);
    console.log(paint.ice(`  ├${bar}┤`));
    for (const r of rows) console.log(`${paint.ice('  │')} ${String(r).padEnd(width - 1)}${paint.ice('│')}`);
    console.log(paint.ice(`  ╰${bar}╯`));
  },
};

export default logger;
