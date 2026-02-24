import { TYPES_PACKAGE_VERSION } from '@enclave/types';
import { Hono } from 'hono';

// Suppress Redis ECONNREFUSED errors at the process level.
// When pasta networking drops, BullMQ's internally-duplicated ioredis
// connections emit unhandled 'error' events that Bun re-throws as
// uncaughtExceptions, flooding stdout. We silence Redis connectivity
// errors here — retryStrategy handles the backoff and reconnection.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') return;
  console.error('[server] uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  const code = (reason as NodeJS.ErrnoException)?.code;
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') return;
  console.error('[server] unhandled rejection:', reason);
});

import { apiApp } from './api/app.js';
import { startIMAPServer } from './imap/server.js';
import { startInboundWorker } from './queue/inbound-worker.js';
import { startOutboundWorker } from './queue/outbound-worker.js';
import { startSMTPServer } from './smtp/server.js';

const app = new Hono();

app.get('/', (c) => {
  return c.json({
    name: 'Enclave Mail Server',
    version: '0.0.1',
    typesVersion: TYPES_PACKAGE_VERSION,
    status: 'running',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.route('/api', apiApp);

const PORT = Number(process.env.API_PORT) || 3001;

// Set ENABLE_MAIL_SERVICES=false in .env to skip SMTP/IMAP/workers during
// API-only or frontend development. Saves ~200–400 MB RAM and avoids spawning
// the Haraka subprocess (which is the heaviest part of startup).
const mailServicesEnabled = process.env.ENABLE_MAIL_SERVICES !== 'false';

const smtpServer = mailServicesEnabled ? startSMTPServer({ cwd: process.cwd() }) : null;
const imapServer = mailServicesEnabled ? startIMAPServer() : null;
const inboundWorker = mailServicesEnabled ? startInboundWorker() : null;
const outboundWorker = mailServicesEnabled ? startOutboundWorker() : null;

if (!mailServicesEnabled) {
  console.log('[server] Mail services disabled (ENABLE_MAIL_SERVICES=false). API only.');
}

process.on('exit', () => {
  smtpServer?.kill();
  imapServer?.stop();
  void inboundWorker?.close();
  void outboundWorker?.close();
});

process.on('SIGINT', () => {
  smtpServer?.kill();
  imapServer?.stop();
  void inboundWorker?.close();
  void outboundWorker?.close();
});

process.on('SIGTERM', () => {
  smtpServer?.kill();
  imapServer?.stop();
  void inboundWorker?.close();
  void outboundWorker?.close();
});

console.log(`Enclave Mail Server running on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
