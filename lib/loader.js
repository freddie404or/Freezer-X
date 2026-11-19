// Plugin registry: scans plugins/**/*.js, validates, de-duplicates and indexes commands.
// One broken plugin is recorded in `problems` and skipped - it never crashes the bot.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hasBin } from './utils.js';
import { CATEGORY_ORDER } from './categories.js';

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
let importCounter = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Returns an error string, or null when the plugin definition is valid. */
export function validatePlugin(p) {
  if (!p || typeof p !== 'object') return 'default export must be an object';
  if (typeof p.name !== 'string' || !NAME_RE.test(p.name)) return 'missing/invalid "name" (use a-z, 0-9, _ or -)';
  if (typeof p.description !== 'string' || !p.description.trim()) return 'missing "description"';
  if (typeof p.execute !== 'function') return 'missing "execute" function';
  if (p.category !== undefined && (typeof p.category !== 'string' || !NAME_RE.test(p.category.toLowerCase()))) return 'invalid "category"';
  if (p.aliases !== undefined && (!Array.isArray(p.aliases) || p.aliases.some((a) => typeof a !== 'string' || !NAME_RE.test(a.toLowerCase())))) {
    return 'invalid "aliases" (array of simple lowercase words)';
  }
  for (const hook of ['before', 'onGroupUpdate']) {
    if (p[hook] !== undefined && typeof p[hook] !== 'function') return `"${hook}" must be a function`;
  }
  return null;
}

export class PluginRegistry {
  /**
   * @param {{dir: string, logger?: any, getDisabled?: () => string[]}} opts
   */
  constructor({ dir, logger, getDisabled = () => [] }) {
    this.dir = dir;
    this.logger = logger;
    this.getDisabled = getDisabled;
    this.plugins = new Map(); // name -> plugin
    this.commands = new Map(); // command/alias -> plugin
    this.problems = []; // {file, kind, reason}
  }

  #problem(file, kind, reason) {
    this.problems.push({ file, kind, reason });
    this.logger?.warn(`plugin ${file}: ${kind} - ${reason}`);
  }

  async load() {
    this.plugins = new Map();
    this.commands = new Map();
    this.problems = [];

    for (const file of walk(this.dir).sort()) {
      const rel = path.relative(this.dir, file).split(path.sep).join('/');
      const folder = rel.includes('/') ? rel.split('/')[0] : 'misc';
      try {
        const mod = await import(`${pathToFileURL(file).href}?v=${++importCounter}`);
        const raw = mod.default;
        const invalid = validatePlugin(raw);
        if (invalid) { this.#problem(rel, 'invalid', invalid); continue; }

        const plugin = {
          ...raw,
          name: raw.name.toLowerCase(),
          category: (raw.category || folder).toLowerCase(),
          aliases: [...new Set((raw.aliases || []).map((a) => a.toLowerCase()))].filter((a) => a !== raw.name.toLowerCase()),
          file: rel,
        };
        plugin.commands = [plugin.name, ...plugin.aliases];

        const missing = this.#missingRequirements(plugin.requires);
        if (missing) { this.#problem(rel, 'unavailable', missing); continue; }

        if (this.plugins.has(plugin.name)) {
          this.#problem(rel, 'duplicate', `plugin name "${plugin.name}" already registered by ${this.plugins.get(plugin.name).file}`);
          continue;
        }
        const clash = plugin.commands.find((c) => this.commands.has(c));
        if (clash) {
          this.#problem(rel, 'duplicate', `command "${clash}" already registered by ${this.commands.get(clash).file}`);
          continue;
        }

        this.plugins.set(plugin.name, plugin);
        for (const c of plugin.commands) this.commands.set(c, plugin);
      } catch (err) {
        this.#problem(rel, 'broken', err?.message || String(err));
      }
    }
    return this.stats();
  }

  #missingRequirements(req) {
    if (!req) return null;
    for (const b of req.bin || []) if (!hasBin(b)) return `requires "${b}" which is not installed`;
    for (const e of req.env || []) if (!process.env[e]) return `requires environment variable ${e}`;
    return null;
  }

  isDisabled(plugin) {
    return this.getDisabled().includes(plugin.name);
  }

  /** Resolve a command or alias to an enabled plugin. */
  get(cmd) {
    const p = this.commands.get(String(cmd).toLowerCase());
    return p && !this.isDisabled(p) ? p : undefined;
  }

  /** Enabled plugins. */
  list() {
    return [...this.plugins.values()].filter((p) => !this.isDisabled(p));
  }

  /** Enabled, visible plugins grouped by category in a stable, nice order. */
  byCategory() {
    const groups = new Map();
    for (const p of this.list()) {
      if (p.hidden) continue;
      if (!groups.has(p.category)) groups.set(p.category, []);
      groups.get(p.category).push(p);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    const rank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : 1000);
    return new Map([...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])));
  }

  stats() {
    const cats = this.byCategory();
    const visible = [...cats.values()].reduce((n, a) => n + a.length, 0);
    return {
      plugins: this.plugins.size,
      commands: visible,
      aliases: [...this.commands.keys()].length,
      categories: cats.size,
      problems: this.problems.length,
    };
  }
}
