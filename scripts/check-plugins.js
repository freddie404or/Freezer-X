// `npm run check` - loads every plugin and prints a health report (no WhatsApp connection needed).
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { PluginRegistry } from '../lib/loader.js';
import { metaFor } from '../lib/categories.js';

const registry = new PluginRegistry({ dir: config.pluginsDir, logger: null });
const stats = await registry.load();

console.log(`\n❄️  ${config.botName} plugin check\n`);
for (const [cat, plugins] of registry.byCategory()) {
  console.log(`${metaFor(cat).emoji} ${metaFor(cat).title} (${plugins.length}): ${plugins.map((p) => p.name).join(', ')}`);
}
console.log(`\nTotal: ${stats.commands} commands, ${stats.aliases} names incl. aliases, ${stats.categories} categories`);

if (registry.problems.length) {
  console.log('\nSkipped plugins:');
  for (const p of registry.problems) console.log(`  [${p.kind}] ${p.file} - ${p.reason}`);
}
const hard = registry.problems.filter((p) => p.kind === 'broken' || p.kind === 'invalid' || p.kind === 'duplicate');
process.exit(hard.length ? 1 : 0);
