import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';

import { type AuthVariables, createAuthMiddleware } from '../middleware/auth.js';
import { AccountServiceError } from '../services/account-service.js';
import { createAccountRouter } from './account.js';

const validBody = {
  email: 'alice@enclave.test',
  salt: '0a0b0c0d',
  verifier: '01020304',
  x25519_public: '11'.repeat(32),
  ed25519_public: '22'.repeat(32),
  encrypted_x25519_private: '33'.repeat(96),
  encrypted_ed25519_private: '44'.repeat(96),
};

const noopConfirmKeyExport = async () => {};
const registrationEnabled = async () => true;
const registrationDisabled = async () => false;

// ---------------------------------------------------------------------------
// Account creation tests
// ---------------------------------------------------------------------------

describe('POST /account/create', () => {
  test('returns userId and sessionToken on success', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => ({ userId: 'user-123', sessionToken: 'session-abc' }),
      confirmKeyExportFn: noopConfirmKeyExport,
      checkRegistrationFn: registrationEnabled,
    });

    const response = await router.request('/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'user-123', sessionToken: 'session-abc' });
  });

  test('returns 400 for missing required fields', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => ({ userId: 'user-123', sessionToken: 'session-abc' }),
      confirmKeyExportFn: noopConfirmKeyExport,
      checkRegistrationFn: registrationEnabled,
    });

    const response = await router.request('/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@enclave.test' }),
    });

    expect(response.status).toBe(400);

    const data = (await response.json()) as { error: string; details: unknown[] };
    expect(data.error).toBe('INVALID_REQUEST');
    expect(Array.isArray(data.details)).toBe(true);
  });

  test('returns 409 when email is already taken', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => {
        throw new AccountServiceError('EMAIL_TAKEN', 'Email already exists');
      },
      confirmKeyExportFn: noopConfirmKeyExport,
      checkRegistrationFn: registrationEnabled,
    });

    const response = await router.request('/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'EMAIL_TAKEN' });
  });

  test('returns 400 for invalid key size errors', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => {
        throw new AccountServiceError('INVALID_KEY_SIZE', 'x25519_public must be exactly 32 bytes');
      },
      confirmKeyExportFn: noopConfirmKeyExport,
      checkRegistrationFn: registrationEnabled,
    });

    const response = await router.request('/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'INVALID_REQUEST',
      details: [{ message: 'x25519_public must be exactly 32 bytes' }],
    });
  });

  test('returns 403 when registration is disabled', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => ({ userId: 'user-123', sessionToken: 'session-abc' }),
      confirmKeyExportFn: noopConfirmKeyExport,
      checkRegistrationFn: registrationDisabled,
    });

    const response = await router.request('/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'REGISTRATION_DISABLED' });
  });

  test('allows account creation when registration is enabled', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => ({ userId: 'user-456', sessionToken: 'session-def' }),
      confirmKeyExportFn: noopConfirmKeyExport,
      checkRegistrationFn: registrationEnabled,
    });

    const response = await router.request('/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'user-456', sessionToken: 'session-def' });
  });
});

// ---------------------------------------------------------------------------
// Confirm key export tests
// ---------------------------------------------------------------------------

describe('POST /account/confirm-key-export', () => {
  function createAppWithAuth(confirmFn: (userId: string) => Promise<void>, userId = 'user-42') {
    const app = new Hono<{ Variables: AuthVariables }>();

    // Simulate authMiddleware by injecting userId into context
    app.use('/account/*', async (c, next) => {
      c.set('userId', userId);
      await next();
    });

    const router = createAccountRouter({
      createAccountFn: async () => ({ userId: 'unused', sessionToken: 'unused' }),
      confirmKeyExportFn: confirmFn,
      checkRegistrationFn: registrationEnabled,
    });

    app.route('/', router);
    return app;
  }

  test('returns 200 and calls confirmKeyExportFn with userId', async () => {
    const confirmFn = mock(async (_userId: string) => {});
    const app = createAppWithAuth(confirmFn);

    const res = await app.request('/account/confirm-key-export', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(confirmFn).toHaveBeenCalledWith('user-42');
  });

  test('is idempotent — calling twice still returns 200', async () => {
    const confirmFn = mock(async (_userId: string) => {});
    const app = createAppWithAuth(confirmFn);

    const res1 = await app.request('/account/confirm-key-export', { method: 'POST' });
    const res2 = await app.request('/account/confirm-key-export', { method: 'POST' });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(confirmFn).toHaveBeenCalledTimes(2);
  });

  test('returns 401 when no auth middleware is applied (unauthenticated)', async () => {
    const validateSessionFn = mock(
      async (_token: string) => null as { userId: string; expiresAt: Date } | null,
    );
    const authMw = createAuthMiddleware(validateSessionFn);

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use('/account/*', authMw);

    const router = createAccountRouter({
      createAccountFn: async () => ({ userId: 'unused', sessionToken: 'unused' }),
      confirmKeyExportFn: async () => {},
      checkRegistrationFn: registrationEnabled,
    });

    app.route('/', router);

    const res = await app.request('/account/confirm-key-export', { method: 'POST' });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
  });

  test('returns 500 when confirmKeyExportFn throws', async () => {
    const confirmFn = mock(async () => {
      throw new Error('DB connection lost');
    });
    const app = createAppWithAuth(confirmFn);

    const res = await app.request('/account/confirm-key-export', { method: 'POST' });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL_ERROR' });
  });
});
