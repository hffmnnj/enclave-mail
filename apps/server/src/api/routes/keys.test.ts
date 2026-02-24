import { Buffer } from 'node:buffer';

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';

import type { AuthVariables } from '../../middleware/auth.js';
import type { KeysRouteDeps } from './keys.js';

mock.module('../../middleware/auth.js', () => {
  return {
    authMiddleware: async (
      c: { set: (key: 'userId', value: string) => void },
      next: () => Promise<void>,
    ) => {
      c.set('userId', 'user-1');
      await next();
    },
    createAuthMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  };
});

const { createKeysRouter } = await import('./keys.js');

const sampleActiveKeys = {
  x25519: {
    type: 'x25519' as const,
    publicKey: Buffer.alloc(32, 1),
    encryptedPrivateKey: Buffer.from('x25519-encrypted-private'),
    createdAt: new Date('2026-02-23T00:00:00.000Z'),
    isActive: true,
  },
  ed25519: {
    type: 'ed25519' as const,
    publicKey: Buffer.alloc(32, 2),
    encryptedPrivateKey: Buffer.from('ed25519-encrypted-private'),
    createdAt: new Date('2026-02-23T00:00:01.000Z'),
    isActive: true,
  },
};

const createApp = (deps: KeysRouteDeps) => {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.route('/', createKeysRouter(deps));
  return app;
};

describe('keys routes', () => {
  test('GET /keys returns active keys with fingerprints', async () => {
    const app = createApp({
      fetchActiveKeys: async () => sampleActiveKeys,
      rotateKeys: async () => {},
      insertPrekeys: async () => {},
      fetchPrekeyBundle: async () => null,
    });

    const response = await app.request('/keys');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        x25519: { publicKey: string; fingerprint: string };
        ed25519: { publicKey: string; fingerprint: string };
      };
    };

    expect(body.data.x25519.publicKey).toBe(Buffer.alloc(32, 1).toString('base64'));
    expect(body.data.ed25519.publicKey).toBe(Buffer.alloc(32, 2).toString('base64'));
    expect(body.data.x25519.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(body.data.ed25519.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  test('GET /keys/export returns encrypted private key bundle only', async () => {
    const app = createApp({
      fetchActiveKeys: async () => sampleActiveKeys,
      rotateKeys: async () => {},
      insertPrekeys: async () => {},
      fetchPrekeyBundle: async () => null,
    });

    const response = await app.request('/keys/export');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        x25519EncryptedPrivateKey: string;
        ed25519EncryptedPrivateKey: string;
      };
    };

    expect(body.data.x25519EncryptedPrivateKey).toBe(
      Buffer.from('x25519-encrypted-private').toString('base64'),
    );
    expect(body.data.ed25519EncryptedPrivateKey).toBe(
      Buffer.from('ed25519-encrypted-private').toString('base64'),
    );
  });

  test('POST /keys/rotate validates input and rotates keys', async () => {
    const rotateKeys = mock(async (_userId: string, _input: unknown) => {});

    const app = createApp({
      fetchActiveKeys: async () => sampleActiveKeys,
      rotateKeys,
      insertPrekeys: async () => {},
      fetchPrekeyBundle: async () => null,
    });

    const payload = {
      x25519PublicKey: Buffer.alloc(32, 8).toString('base64'),
      x25519EncryptedPrivateKey: Buffer.from('enc-x').toString('base64'),
      ed25519PublicKey: Buffer.alloc(32, 9).toString('base64'),
      ed25519EncryptedPrivateKey: Buffer.from('enc-e').toString('base64'),
    };

    const response = await app.request('/keys/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    expect(rotateKeys).toHaveBeenCalledWith('user-1', payload);
  });

  test('GET /keys/:userId/public returns 404 when no keys exist', async () => {
    const app = createApp({
      fetchActiveKeys: async () => null,
      rotateKeys: async () => {},
      insertPrekeys: async () => {},
      fetchPrekeyBundle: async () => null,
    });

    const response = await app.request('/keys/user-2/public');
    expect(response.status).toBe(404);
  });

  test('POST /keys/prekeys uploads signed and one-time prekeys', async () => {
    const insertPrekeys = mock(async (_userId: string, _input: unknown) => {});

    const app = createApp({
      fetchActiveKeys: async () => sampleActiveKeys,
      rotateKeys: async () => {},
      insertPrekeys,
      fetchPrekeyBundle: async () => null,
    });

    const payload = {
      signedPrekey: {
        keyId: 1,
        publicKey: Buffer.alloc(32, 3).toString('base64'),
        signature: Buffer.alloc(64, 4).toString('base64'),
      },
      oneTimePrekeys: [{ keyId: 2, publicKey: Buffer.alloc(32, 5).toString('base64') }],
    };

    const response = await app.request('/keys/prekeys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    expect(insertPrekeys).toHaveBeenCalledWith('user-1', payload);
  });

  test('GET /keys/prekeys/:userId returns prekey bundle', async () => {
    const app = createApp({
      fetchActiveKeys: async () => sampleActiveKeys,
      rotateKeys: async () => {},
      insertPrekeys: async () => {},
      fetchPrekeyBundle: async () => ({
        identityKey: Buffer.alloc(32, 6).toString('base64'),
        signedPrekey: {
          keyId: 10,
          publicKey: Buffer.alloc(32, 7).toString('base64'),
          signature: Buffer.alloc(64, 8).toString('base64'),
        },
        oneTimePrekey: {
          keyId: 11,
          publicKey: Buffer.alloc(32, 9).toString('base64'),
        },
      }),
    });

    const response = await app.request('/keys/prekeys/user-2');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { signedPrekey: { keyId: number }; oneTimePrekey?: { keyId: number } };
    };
    expect(body.data.signedPrekey.keyId).toBe(10);
    expect(body.data.oneTimePrekey?.keyId).toBe(11);
  });
});
