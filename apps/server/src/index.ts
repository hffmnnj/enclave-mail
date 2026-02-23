import { Hono } from 'hono';
import { TYPES_PACKAGE_VERSION } from '@enclave/types';

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

const PORT = Number(process.env.API_PORT) || 3001;

console.log(`Enclave Mail Server running on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
