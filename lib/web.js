// Web connect page: shows the QR code or lets you request a pairing code.
// Protected by an access key (WEB_KEY, or a random key printed in the terminal).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from '../config.js';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function startWebServer({ config, logger, connection, registry }) {
  const accessKey = config.webKey || crypto.randomBytes(4).toString('hex');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8').replaceAll('{{BOT_NAME}}', config.botName);
  const attempts = new Map(); // ip -> [timestamps]

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const authorised = (req) => safeEqual(req.headers['x-access-key'] || '', accessKey);
  const limited = (ip) => {
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter((t) => now - t < 60_000);
    list.push(now);
    attempts.set(ip, list);
    return list.length > 8;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const ip = req.socket.remoteAddress || 'unknown';

      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, html, 'text/html');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, 'ok', 'text/plain');

      if (req.method === 'GET' && url.pathname === '/api/status') {
        const ok = authorised(req);
        if (!ok && req.headers['x-access-key'] && limited(ip)) return send(res, 429, { error: 'Too many attempts. Wait a minute.' });
        const body = {
          bot: config.botName,
          version: config.version,
          status: connection.status,
          commands: registry.stats().commands,
          authorised: ok,
        };
        if (connection.status === 'connected') body.number = connection.user?.id?.split(':')[0]?.split('@')[0] ?? null;
        if (ok && connection.status === 'waiting_auth') {
          body.pairingCode = connection.pairingCode;
          if (connection.qr) {
            const QR = (await import('qrcode')).default;
            body.qr = await QR.toDataURL(connection.qr, { margin: 1, width: 320, color: { dark: '#0b1d33', light: '#ffffff' } });
          }
        }
        return send(res, 200, body);
      }

      if (req.method === 'POST' && url.pathname === '/api/pair') {
        if (!authorised(req)) return send(res, 401, { error: 'Invalid access key.' });
        if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Wait a minute.' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2000) return send(res, 413, { error: 'Payload too large.' });
        }
        const { number } = JSON.parse(raw || '{}');
        try {
          const code = await connection.requestPairing(number);
          return send(res, 200, { code });
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }

      send(res, 404, { error: 'Not found' });
    } catch (err) {
      logger.error('web:', err?.message || err);
      send(res, 500, { error: 'Server error' });
    }
  });

  server.on('error', (err) => logger.error(`Web server error: ${err.message}`));
  server.listen(config.port, '0.0.0.0', () => {
    logger.ok(`Web connect page on port ${config.port}`);
    if (!config.webKey) logger.info(`Web access key (this run): ${accessKey}  — set WEB_KEY to choose your own`);
  });
  return server;
}
