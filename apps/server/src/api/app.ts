import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';

import type { ApiError } from './types.js';

// ---------------------------------------------------------------------------
// CORS configuration
// ---------------------------------------------------------------------------

const parseCorsOrigins = (): string[] | string => {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || raw === '*') {
    return '*';
  }
  return raw.split(',').map((origin) => origin.trim());
};

// ---------------------------------------------------------------------------
// Hono API application
// ---------------------------------------------------------------------------

export const apiApp = new Hono();

// --- CORS ---
apiApp.use(
  '*',
  cors({
    origin: parseCorsOrigins(),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 86_400,
    credentials: true,
  }),
);

// --- Security headers ---
apiApp.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('X-XSS-Protection', '1; mode=block');
});

// --- Request logging ---
apiApp.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  const duration = (performance.now() - start).toFixed(1);
  const { method } = c.req;
  const path = c.req.path;
  const status = c.res.status;
  console.log(`${method} ${path} ${String(status)} ${duration}ms`);
});

// --- Global error handler ---
apiApp.onError((err, c) => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (err instanceof ZodError) {
    const body: ApiError = isProduction
      ? { error: 'Validation failed', code: 'VALIDATION_ERROR' }
      : { error: 'Validation failed', code: 'VALIDATION_ERROR', details: err.issues };
    return c.json(body, 400);
  }

  const body: ApiError = isProduction
    ? { error: 'Internal server error', code: 'INTERNAL_ERROR' }
    : { error: err.message, code: 'INTERNAL_ERROR' };

  return c.json(body, 500);
});

// --- 404 handler ---
apiApp.notFound((c) => {
  const body: ApiError = { error: 'Not found', code: 'NOT_FOUND' };
  return c.json(body, 404);
});

// ---------------------------------------------------------------------------
// Type export for Hono RPC client
// ---------------------------------------------------------------------------

export type ApiAppType = typeof apiApp;
