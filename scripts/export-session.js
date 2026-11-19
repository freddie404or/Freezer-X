// `npm run session` - prints SESSION_ID (FREEZER~<base64 zip of creds.json>) for hosts with ephemeral disks.
// Treat the output like a password: anyone holding it can control the linked WhatsApp account.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { encodeSessionId } from '../lib/session.js';

const file = path.join(config.sessionDir, 'creds.json');
if (!fs.existsSync(file)) {
  console.error('No session found. Start the bot and link WhatsApp first.');
  process.exit(1);
}
console.log('\nSESSION_ID (keep it secret, set it as an environment variable only):\n');
console.log(encodeSessionId(fs.readFileSync(file)));
console.log();
