import { Buffer } from 'node:buffer';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

interface MockUserRecord {
  id: string;
  srpSalt: Uint8Array;
  srpVerifier: Uint8Array;
}

const selectWhereMock = mock(async (): Promise<Array<{ id: string } | MockUserRecord>> => []);
const insertReturningMock = mock(async (): Promise<Array<{ id: string }>> => [{ id: 'user-123' }]);

const redisStore = new Map<string, string>();
const redisSetMock = mock(
  async (key: string, value: string, _mode: string, _ttl: number): Promise<'OK'> => {
    redisStore.set(key, value);
    return 'OK';
  },
);
const redisGetMock = mock(
  async (key: string): Promise<string | null> => redisStore.get(key) ?? null,
);
const redisDelMock = mock(async (key: string): Promise<number> => (redisStore.delete(key) ? 1 : 0));

const createSessionMock = mock(
  async (userId: string): Promise<{ token: string; expiresAt: Date }> => ({
    token: `session-${userId}`,
    expiresAt: new Date('2100-01-01T00:00:00.000Z'),
  }),
);
const invalidateSessionMock = mock(async (_token: string): Promise<void> => {});

const srpGenerateServerEphemeralMock = mock(
  (verifier: string): { public: string; secret: string } => ({
    public: `B-${verifier.slice(0, 8)}`,
    secret: 'server-secret',
  }),
);
const srpDeriveServerSessionMock = mock(
  (
    _serverEphemeral: { public: string; secret: string },
    _clientPublicEphemeral: string,
    _salt: string,
    _email: string,
    _verifier: string,
    _clientProof: string,
  ): { key: string; proof: string } => ({
    key: 'shared-session-key',
    proof: 'server-proof',
  }),
);

const authRateLimitMock = async (_c: unknown, next: () => Promise<void>): Promise<void> => {
  await next();
};

mock.module('@enclave/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: selectWhereMock,
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: insertReturningMock,
      }),
    }),
  },
  users: {
    id: 'id-column',
    email: 'email-column',
    srpSalt: 'srp-salt-column',
    srpVerifier: 'srp-verifier-column',
  },
}));

mock.module('drizzle-orm', () => ({
  eq: (column: string, value: string) => ({ column, value }),
}));

mock.module('@enclave/crypto', () => ({
  srpGenerateServerEphemeral: srpGenerateServerEphemeralMock,
  srpDeriveServerSession: srpDeriveServerSessionMock,
}));

mock.module('../queue/connection.js', () => ({
  redis: {
    set: redisSetMock,
    get: redisGetMock,
    del: redisDelMock,
  },
}));

mock.module('../middleware/session.js', () => ({
  createSession: createSessionMock,
  invalidateSession: invalidateSessionMock,
}));

mock.module('../middleware/rate-limit.js', () => ({
  authRateLimit: authRateLimitMock,
}));

const { authRouter } = await import('./auth.js');

const bytesFromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));

describe('authRouter', () => {
  beforeEach(() => {
    redisStore.clear();

    selectWhereMock.mockReset();
    insertReturningMock.mockReset();
    redisSetMock.mockClear();
    redisGetMock.mockClear();
    redisDelMock.mockClear();
    createSessionMock.mockClear();
    invalidateSessionMock.mockClear();
    srpGenerateServerEphemeralMock.mockClear();
    srpDeriveServerSessionMock.mockClear();

    selectWhereMock.mockImplementation(
      async (): Promise<Array<{ id: string } | MockUserRecord>> => [],
    );
    insertReturningMock.mockImplementation(
      async (): Promise<Array<{ id: string }>> => [{ id: 'user-123' }],
    );
  });

  test('POST /auth/register creates a user from SRP verifier data', async () => {
    const response = await authRouter.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'Alice@Enclave.Test',
        salt: '0a0b0c0d',
        verifier: '01020304',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'user-123' });
    expect(insertReturningMock).toHaveBeenCalledTimes(1);
  });

  test('POST /auth/register rejects malformed request bodies', async () => {
    const response = await authRouter.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        salt: 'not-hex',
        verifier: 'still-not-hex',
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVALID_BODY' });
    expect(insertReturningMock).toHaveBeenCalledTimes(0);
  });

  test('POST /auth/register returns 409 when email is already taken', async () => {
    selectWhereMock.mockImplementationOnce(
      async (): Promise<Array<{ id: string }>> => [{ id: 'existing-user' }],
    );

    const response = await authRouter.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@enclave.test',
        salt: '0a0b',
        verifier: '0c0d',
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'EMAIL_TAKEN' });
  });

  test('POST /auth/login/start returns SRP challenge and stores server state', async () => {
    selectWhereMock.mockImplementationOnce(
      async (): Promise<Array<MockUserRecord>> => [
        {
          id: 'user-login',
          srpSalt: bytesFromHex('0a0b0c0d'),
          srpVerifier: bytesFromHex('01020304'),
        },
      ],
    );

    const response = await authRouter.request('/auth/login/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@enclave.test', A: 'abcdef01' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      B: 'B-01020304',
      salt: '0a0b0c0d',
    });

    expect(redisSetMock).toHaveBeenCalledTimes(1);
    expect(redisSetMock).toHaveBeenCalledWith(
      'srp:alice@enclave.test',
      expect.any(String),
      'EX',
      30,
    );
  });

  test('POST /auth/login/start returns generic 401 for unknown users', async () => {
    const response = await authRouter.request('/auth/login/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@enclave.test', A: 'abcdef01' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_FAILED' });
  });

  test('POST /auth/login/finish verifies proof and creates a session', async () => {
    redisStore.set(
      'srp:alice@enclave.test',
      JSON.stringify({
        userId: 'user-login',
        email: 'alice@enclave.test',
        salt: '0a0b0c0d',
        verifier: '01020304',
        clientPublicEphemeral: 'abcdef01',
        serverPublicEphemeral: 'B-01020304',
        serverSecretEphemeral: 'server-secret',
      }),
    );

    const response = await authRouter.request('/auth/login/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@enclave.test', clientProof: 'deadbeef' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessionToken: 'session-user-login',
      serverProof: 'server-proof',
    });
    expect(createSessionMock).toHaveBeenCalledWith('user-login');
    expect(redisDelMock).toHaveBeenCalledWith('srp:alice@enclave.test');
  });

  test('POST /auth/login/finish returns generic 401 when SRP state is missing', async () => {
    const response = await authRouter.request('/auth/login/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@enclave.test', clientProof: 'deadbeef' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_FAILED' });
    expect(createSessionMock).toHaveBeenCalledTimes(0);
  });

  test('POST /auth/login/finish returns generic 401 when proof verification fails', async () => {
    redisStore.set(
      'srp:alice@enclave.test',
      JSON.stringify({
        userId: 'user-login',
        email: 'alice@enclave.test',
        salt: '0a0b0c0d',
        verifier: '01020304',
        clientPublicEphemeral: 'abcdef01',
        serverPublicEphemeral: 'B-01020304',
        serverSecretEphemeral: 'server-secret',
      }),
    );

    srpDeriveServerSessionMock.mockImplementationOnce(() => {
      throw new Error('bad-proof');
    });

    const response = await authRouter.request('/auth/login/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@enclave.test', clientProof: 'deadbeef' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_FAILED' });
    expect(createSessionMock).toHaveBeenCalledTimes(0);
    expect(redisStore.has('srp:alice@enclave.test')).toBe(false);
  });

  test('POST /auth/logout invalidates bearer token and returns 204', async () => {
    const response = await authRouter.request('/auth/logout', {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
    });

    expect(response.status).toBe(204);
    expect(invalidateSessionMock).toHaveBeenCalledWith('token-123');
  });

  test('POST /auth/logout returns 401 when Authorization header is missing', async () => {
    const response = await authRouter.request('/auth/logout', {
      method: 'POST',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_FAILED' });
    expect(invalidateSessionMock).toHaveBeenCalledTimes(0);
  });
});
