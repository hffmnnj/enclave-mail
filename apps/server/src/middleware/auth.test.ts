import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';

const validateSessionMock = mock(
  async (_token: string): Promise<{ userId: string; expiresAt: Date } | null> => null,
);
const { createAuthMiddleware, createRequireKeyExportMiddleware } = await import('./auth.js');

type LookupKeyExportFn = (userId: string) => Promise<{ keyExportConfirmed: boolean } | null>;

// ---------------------------------------------------------------------------
// Test app — a minimal Hono instance with the auth middleware applied
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use('*', createAuthMiddleware(validateSessionMock));
  app.get('/protected', (c) => c.json({ userId: c.get('userId') }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authMiddleware', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
    validateSessionMock.mockReset();
    validateSessionMock.mockImplementation(async () => null);
  });

  test('returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/protected');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(validateSessionMock).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header does not start with Bearer', async () => {
    const res = await app.request('/protected', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(validateSessionMock).not.toHaveBeenCalled();
  });

  test('returns 401 when Bearer token is empty', async () => {
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer ' },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(validateSessionMock).not.toHaveBeenCalled();
  });

  test('returns 401 when session validation returns null (invalid token)', async () => {
    validateSessionMock.mockResolvedValueOnce(null);

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid-token-abc' },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(validateSessionMock).toHaveBeenCalledWith('invalid-token-abc');
  });

  test('returns 401 when session validation returns null (expired token)', async () => {
    validateSessionMock.mockResolvedValueOnce(null);

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer expired-token-xyz' },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(validateSessionMock).toHaveBeenCalledWith('expired-token-xyz');
  });

  test('injects userId into context and calls next on valid token', async () => {
    validateSessionMock.mockResolvedValueOnce({
      userId: 'user-42',
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
    });

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token-123' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-42' });
    expect(validateSessionMock).toHaveBeenCalledWith('valid-token-123');
  });

  test('passes the exact token (without Bearer prefix) to validateSession', async () => {
    validateSessionMock.mockResolvedValueOnce({
      userId: 'user-99',
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
    });

    await app.request('/protected', {
      headers: { Authorization: 'Bearer abc123def456' },
    });

    expect(validateSessionMock).toHaveBeenCalledTimes(1);
    expect(validateSessionMock).toHaveBeenCalledWith('abc123def456');
  });

  test('does not leak error details — same response for all failure modes', async () => {
    // Missing header
    const res1 = await app.request('/protected');
    // Wrong scheme
    const res2 = await app.request('/protected', {
      headers: { Authorization: 'Token abc' },
    });
    // Invalid token
    validateSessionMock.mockResolvedValueOnce(null);
    const res3 = await app.request('/protected', {
      headers: { Authorization: 'Bearer bad' },
    });

    const body1 = await res1.json();
    const body2 = await res2.json();
    const body3 = await res3.json();

    expect(body1).toEqual({ error: 'UNAUTHORIZED' });
    expect(body2).toEqual({ error: 'UNAUTHORIZED' });
    expect(body3).toEqual({ error: 'UNAUTHORIZED' });
  });

  test('allows multiple sequential requests with different tokens', async () => {
    validateSessionMock
      .mockResolvedValueOnce({
        userId: 'user-a',
        expiresAt: new Date('2100-01-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        userId: 'user-b',
        expiresAt: new Date('2100-01-01T00:00:00.000Z'),
      });

    const res1 = await app.request('/protected', {
      headers: { Authorization: 'Bearer token-a' },
    });
    const res2 = await app.request('/protected', {
      headers: { Authorization: 'Bearer token-b' },
    });

    expect(await res1.json()).toEqual({ userId: 'user-a' });
    expect(await res2.json()).toEqual({ userId: 'user-b' });
    expect(validateSessionMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// requireKeyExport middleware
// ---------------------------------------------------------------------------

describe('requireKeyExport', () => {
  function createKeyExportApp(lookupFn: LookupKeyExportFn) {
    const middleware = createRequireKeyExportMiddleware(lookupFn);
    const app = new Hono<{ Variables: { userId: string } }>();

    // Simulate authMiddleware — inject userId before requireKeyExport runs
    app.use('*', async (c, next) => {
      c.set('userId', 'user-42');
      await next();
    });
    app.use('*', middleware);
    app.get('/mailbox', (c) => c.json({ data: 'inbox-contents' }));

    return app;
  }

  test('passes through when key export is confirmed', async () => {
    const lookupFn = mock<LookupKeyExportFn>(async () => ({ keyExportConfirmed: true }));
    const app = createKeyExportApp(lookupFn);

    const res = await app.request('/mailbox');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: 'inbox-contents' });
    expect(lookupFn).toHaveBeenCalledWith('user-42');
  });

  test('blocks with 403 and KEY_EXPORT_REQUIRED when flag is false', async () => {
    const lookupFn = mock<LookupKeyExportFn>(async () => ({ keyExportConfirmed: false }));
    const app = createKeyExportApp(lookupFn);

    const res = await app.request('/mailbox');

    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('KEY_EXPORT_REQUIRED');
    expect(body.message).toBe('You must export your encryption keys before accessing mail');
  });

  test('returns 401 when userId is not found in database', async () => {
    const lookupFn = mock<LookupKeyExportFn>(async () => null);
    const app = createKeyExportApp(lookupFn);

    const res = await app.request('/mailbox');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
  });
});
