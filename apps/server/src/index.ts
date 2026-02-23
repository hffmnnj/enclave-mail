import { TYPES_PACKAGE_VERSION } from '@enclave/types';
import { Hono } from 'hono';

import { startInboundWorker } from './queue/inbound-worker.js';
import { startOutboundWorker } from './queue/outbound-worker.js';
import { accountRouter } from './routes/account.js';
import { authRouter } from './routes/auth.js';
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

app.route('/', authRouter);
app.route('/', accountRouter);

const PORT = Number(process.env.API_PORT) || 3001;

const smtpServer = startSMTPServer({ cwd: process.cwd() });
const inboundWorker = startInboundWorker();
const outboundWorker = startOutboundWorker();

process.on('exit', () => {
  smtpServer.kill();
  void inboundWorker.close();
  void outboundWorker.close();
});

process.on('SIGINT', () => {
  smtpServer.kill();
  void inboundWorker.close();
  void outboundWorker.close();
});

process.on('SIGTERM', () => {
  smtpServer.kill();
  void inboundWorker.close();
  void outboundWorker.close();
});

console.log(`Enclave Mail Server running on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
