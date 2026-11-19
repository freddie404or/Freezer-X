// Small JSON-file database (atomic, debounced writes). Enough for settings, warns, bans.
import fs from 'node:fs';
import path from 'node:path';

const defaults = () => ({ settings: { mode: null }, disabledPlugins: [], groups: {}, chats: {} });
const groupDefaults = () => ({
  antilink: false, // false | 'delete' | 'kick'
  antibadword: false,
  badwords: [],
  welcome: false,
  goodbye: false,
  welcomeText: '',
  goodbyeText: '',
  banned: [],
  warns: {},
});

export class Database {
  constructor(file) {
    this.file = file;
    this.data = defaults();
    this.timer = null;
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (!fs.existsSync(this.file)) return;
      this.data = { ...defaults(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      this.data = defaults();
    }
  }

  /** Per-group settings, created on demand with defaults. */
  group(jid) {
    const g = (this.data.groups[jid] ??= {});
    for (const [k, v] of Object.entries(groupDefaults())) if (!(k in g)) g[k] = v;
    return g;
  }

  chat(jid) {
    return (this.data.chats[jid] ??= {});
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch { /* disk may be read-only; the bot keeps running with in-memory data */ }
  }
}
