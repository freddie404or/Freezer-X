// ❄️ FREEZER MD - entry point
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { logger, banner, paint } from './lib/logger.js';
import { Database } from './lib/db.js';
import { PluginRegistry } from './lib/loader.js';
import { Handler } from './lib/handler.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`FREEZER MD needs Node.js 20 or newer (found ${process.versions.node}).`);
  process.exit(1);
}

banner({ name: config.botName, version: config.version });

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new Database(path.join(config.dataDir, 'db.json'));

const registry = new PluginRegistry({ dir: config.pluginsDir, logger, getDisabled: () => db.data.disabledPlugins });
const stats = await registry.load();
logger.ok(`Plugins loaded: ${paint.bold(stats.commands)} commands in ${stats.categories} categories (${stats.plugins} plugin files)`);
for (const p of registry.problems) {
  if (p.kind === 'unavailable') logger.info(`Hidden: ${p.file} (${p.reason})`);
}
if (registry.problems.some((p) => p.kind !== 'unavailable')) logger.warn('Some plugins are broken/duplicated - run "npm run check" for details');

// `app` is shared with plugins (restart/shutdown/uptime) through ctx.app
const app = { startedAt: Date.now(), connection: null, restart: null, shutdown: null };
const handler = new Handler({ config, db, registry, logger, app });

// Baileys is imported lazily so `npm run check` / tests work without it.
const { Connection } = await import('./lib/connection.js');
const { startWebServer } = await import('./lib/web.js');

const connection = new Connection({ config, logger, handler, db });
app.connection = connection;
app.restart = () => connection.restart();
app.shutdown = async () => {
  logger.info('Shutting down…');
  db.flush();
  await connection.stop();
  process.exit(0);
};

startWebServer({ config, logger, connection, registry });

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.shutdown());
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection:', err?.message || err));
process.on('uncaughtException', (err) => logger.error('Uncaught exception:', err?.stack || err));

logger.info('Connecting to WhatsApp…');
await connection.start();

