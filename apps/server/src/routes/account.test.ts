import { describe, expect, test } from 'bun:test';

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

describe('accountRouter', () => {
  test('POST /account/create returns userId and sessionToken on success', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => ({ userId: 'user-123', sessionToken: 'session-abc' }),
    });

    const response = await router.request('/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'user-123', sessionToken: 'session-abc' });
  });

  test('POST /account/create returns 400 for missing required fields', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => ({ userId: 'user-123', sessionToken: 'session-abc' }),
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

  test('POST /account/create returns 409 when email is already taken', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => {
        throw new AccountServiceError('EMAIL_TAKEN', 'Email already exists');
      },
    });

    const response = await router.request('/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'EMAIL_TAKEN' });
  });

  test('POST /account/create returns 400 for invalid key size errors', async () => {
    const router = createAccountRouter({
      createAccountFn: async () => {
        throw new AccountServiceError('INVALID_KEY_SIZE', 'x25519_public must be exactly 32 bytes');
      },
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
});
