import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Redis mock — in-memory Map simulating ioredis commands
// ---------------------------------------------------------------------------

const store = new Map<string, string>();
const sets = new Map<string, Set<string>>();
const ttls = new Map<string, number>();

const redisMock = {
  set: mock(async (key: string, value: string, mode?: string, ttl?: number): Promise<'OK'> => {
    store.set(key, value);
    if (mode === 'EX' && ttl !== undefined) {
      ttls.set(key, ttl);
    }
    return 'OK';
  }),

  get: mock(async (key: string): Promise<string | null> => store.get(key) ?? null),

  del: mock(async (...keys: string[]): Promise<number> => {
    let count = 0;
    for (const key of keys) {
      if (store.delete(key) || sets.delete(key)) count++;
      ttls.delete(key);
    }
    return count;
  }),

  sadd: mock(async (key: string, ...members: string[]): Promise<number> => {
    let s = sets.get(key);
    if (!s) {
      s = new Set();
      sets.set(key, s);
    }
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) {
        s.add(m);
        added++;
      }
    }
    return added;
  }),

  srem: mock(async (key: string, ...members: string[]): Promise<number> => {
    const s = sets.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) {
      if (s.delete(m)) removed++;
    }
    return removed;
  }),

  smembers: mock(async (key: string): Promise<string[]> => {
    const s = sets.get(key);
    return s ? [...s] : [];
  }),

  expire: mock(async (key: string, seconds: number): Promise<number> => {
    ttls.set(key, seconds);
    return 1;
  }),
};

mock.module('../queue/connection.js', () => ({
  redis: redisMock,
}));

const { createSession, validateSession, invalidateSession, invalidateAllSessions } = await import(
  './session-manager.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256hex(hexInput: string): string {
  return createHash('sha256').update(hexInput, 'hex').digest('hex');
}

function clearRedis(): void {
  store.clear();
  sets.clear();
  ttls.clear();
  redisMock.set.mockClear();
  redisMock.get.mockClear();
  redisMock.del.mockClear();
  redisMock.sadd.mockClear();
  redisMock.srem.mockClear();
  redisMock.smembers.mockClear();
  redisMock.expire.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-manager', () => {
  beforeEach(clearRedis);
  afterEach(clearRedis);

  // -----------------------------------------------------------------------
  // createSession
  // -----------------------------------------------------------------------

  describe('createSession', () => {
    test('returns a 64-character hex token and a future expiry date', async () => {
      const { token, expiresAt } = await createSession('user-1');

      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    test('stores the SHA-256 hash of the token in Redis, never the raw token', async () => {
      const { token } = await createSession('user-1');
      const expectedHash = sha256hex(token);

      expect(store.has(`session:${expectedHash}`)).toBe(true);
      // Raw token must NOT appear as a Redis key
      expect(store.has(`session:${token}`)).toBe(false);
    });

    test('stores session data with userId and expiresAt', async () => {
      const { token, expiresAt } = await createSession('user-1');
      const hash = sha256hex(token);
      const raw = store.get(`session:${hash}`);

      expect(raw).toBeDefined();
      const data = JSON.parse(raw!);
      expect(data.userId).toBe('user-1');
      expect(data.expiresAt).toBe(expiresAt.toISOString());
    });

    test('sets a TTL on the session key', async () => {
      const { token } = await createSession('user-1');
      const hash = sha256hex(token);

      expect(redisMock.set).toHaveBeenCalledWith(
        `session:${hash}`,
        expect.any(String),
        'EX',
        expect.any(Number),
      );

      const ttl = ttls.get(`session:${hash}`);
      expect(ttl).toBeGreaterThan(0);
    });

    test('adds the token hash to the per-user session set', async () => {
      const { token } = await createSession('user-1');
      const hash = sha256hex(token);
      const userSet = sets.get('user-sessions:user-1');

      expect(userSet).toBeDefined();
      expect(userSet!.has(hash)).toBe(true);
    });

    test('sets a TTL on the per-user session set', async () => {
      await createSession('user-1');

      expect(redisMock.expire).toHaveBeenCalledWith('user-sessions:user-1', expect.any(Number));
    });

    test('generates unique tokens for each call', async () => {
      const a = await createSession('user-1');
      const b = await createSession('user-1');

      expect(a.token).not.toBe(b.token);
    });

    test('tracks multiple sessions for the same user', async () => {
      const a = await createSession('user-1');
      const b = await createSession('user-1');
      const userSet = sets.get('user-sessions:user-1');

      expect(userSet).toBeDefined();
      expect(userSet!.size).toBe(2);
      expect(userSet!.has(sha256hex(a.token))).toBe(true);
      expect(userSet!.has(sha256hex(b.token))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // validateSession
  // -----------------------------------------------------------------------

  describe('validateSession', () => {
    test('returns userId and expiresAt for a valid token', async () => {
      const { token, expiresAt } = await createSession('user-1');
      const result = await validateSession(token);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
      expect(result!.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    });

    test('returns null for an unknown token', async () => {
      const result = await validateSession('0'.repeat(64));

      expect(result).toBeNull();
    });

    test('returns null for an expired session', async () => {
      const { token } = await createSession('user-1');
      const hash = sha256hex(token);

      // Manually set the expiresAt to the past
      const expired = JSON.stringify({
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      });
      store.set(`session:${hash}`, expired);

      const result = await validateSession(token);
      expect(result).toBeNull();
    });

    test('deletes the Redis key when an expired session is detected', async () => {
      const { token } = await createSession('user-1');
      const hash = sha256hex(token);

      store.set(
        `session:${hash}`,
        JSON.stringify({
          userId: 'user-1',
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        }),
      );

      await validateSession(token);

      expect(redisMock.del).toHaveBeenCalledWith(`session:${hash}`);
    });

    test('returns null for an empty string token', async () => {
      const result = await validateSession('');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // invalidateSession
  // -----------------------------------------------------------------------

  describe('invalidateSession', () => {
    test('removes the session key from Redis', async () => {
      const { token } = await createSession('user-1');
      const hash = sha256hex(token);

      await invalidateSession(token);

      expect(store.has(`session:${hash}`)).toBe(false);
    });

    test('removes the token hash from the per-user session set', async () => {
      const { token } = await createSession('user-1');
      const hash = sha256hex(token);

      await invalidateSession(token);

      const userSet = sets.get('user-sessions:user-1');
      expect(userSet === undefined || !userSet.has(hash)).toBe(true);
    });

    test('is idempotent — does not throw for an already-invalidated token', async () => {
      const { token } = await createSession('user-1');

      await invalidateSession(token);
      // Second call should not throw
      await invalidateSession(token);
    });

    test('is idempotent — does not throw for a completely unknown token', async () => {
      await invalidateSession('0'.repeat(64));
    });

    test('does not affect other sessions for the same user', async () => {
      const a = await createSession('user-1');
      const b = await createSession('user-1');

      await invalidateSession(a.token);

      const result = await validateSession(b.token);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
    });
  });

  // -----------------------------------------------------------------------
  // invalidateAllSessions
  // -----------------------------------------------------------------------

  describe('invalidateAllSessions', () => {
    test('removes all session keys for a user', async () => {
      const a = await createSession('user-1');
      const b = await createSession('user-1');

      await invalidateAllSessions('user-1');

      expect(await validateSession(a.token)).toBeNull();
      expect(await validateSession(b.token)).toBeNull();
    });

    test('removes the per-user session set', async () => {
      await createSession('user-1');
      await createSession('user-1');

      await invalidateAllSessions('user-1');

      expect(redisMock.del).toHaveBeenCalledWith('user-sessions:user-1');
    });

    test('does not affect sessions belonging to other users', async () => {
      await createSession('user-1');
      const other = await createSession('user-2');

      await invalidateAllSessions('user-1');

      const result = await validateSession(other.token);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-2');
    });

    test('is idempotent — does not throw for a user with no sessions', async () => {
      await invalidateAllSessions('nonexistent-user');
    });

    test('handles a user with many sessions', async () => {
      const tokens: string[] = [];
      for (let i = 0; i < 10; i++) {
        const { token } = await createSession('user-1');
        tokens.push(token);
      }

      await invalidateAllSessions('user-1');

      for (const token of tokens) {
        expect(await validateSession(token)).toBeNull();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Token security properties
  // -----------------------------------------------------------------------

  describe('security properties', () => {
    test('token is 32 bytes (64 hex characters)', async () => {
      const { token } = await createSession('user-1');
      expect(token.length).toBe(64);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    test('raw token never appears in any Redis key', async () => {
      const { token } = await createSession('user-1');

      for (const key of store.keys()) {
        expect(key).not.toContain(token);
      }
    });

    test('session data stored in Redis does not contain the raw token', async () => {
      const { token } = await createSession('user-1');

      for (const value of store.values()) {
        expect(value).not.toContain(token);
      }
    });
  });
});
