import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mock Redis — track all commands issued
// ---------------------------------------------------------------------------

interface MultiChain {
  zremrangebyscore: (...args: unknown[]) => MultiChain;
  zadd: (...args: unknown[]) => MultiChain;
  zcard: (...args: unknown[]) => MultiChain;
  expire: (...args: unknown[]) => MultiChain;
  exec: () => Promise<Array<[Error | null, unknown]> | null>;
}

let multiResults: Array<[Error | null, unknown]> | null = [
  [null, 0], // ZREMRANGEBYSCORE
  [null, 1], // ZADD
  [null, 1], // ZCARD — 1 request in window
  [null, 1], // EXPIRE
];

let incrResult = 1;
let ttlResult = 60;

const multiExecMock = mock(async (): Promise<Array<[Error | null, unknown]> | null> => {
  return multiResults;
});

const redisMock = {
  incr: mock(async (): Promise<number> => incrResult),
  expire: mock(async (): Promise<number> => 1),
  ttl: mock(async (): Promise<number> => ttlResult),
  multi: mock((): MultiChain => {
    const chain: MultiChain = {
      zremrangebyscore: () => chain,
      zadd: () => chain,
      zcard: () => chain,
      expire: () => chain,
      exec: multiExecMock,
    };
    return chain;
  }),
};

mock.module('../queue/connection.js', () => ({
  redis: redisMock,
  createRedisConnection: () => redisMock,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { createUserRateLimiter, rateLimitMiddleware } = await import('./rate-limit.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp(middleware: MiddlewareHandler) {
  const app = new Hono();

  // Simulate auth middleware setting userId
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-001' as never);
    await next();
  });

  app.use('*', middleware);
  app.get('/test', (c) => c.json({ ok: true }));
  app.post('/test', (c) => c.json({ ok: true }));

  return app;
}

async function makeRequest(app: Hono, path = '/test', method = 'GET'): Promise<Response> {
  const result = app.request(path, { method });
  return result instanceof Promise ? result : Promise.resolve(result);
}

// ---------------------------------------------------------------------------
// Tests: createUserRateLimiter (sliding window)
// ---------------------------------------------------------------------------

describe('createUserRateLimiter', () => {
  beforeEach(() => {
    multiResults = [
      [null, 0], // ZREMRANGEBYSCORE
      [null, 1], // ZADD
      [null, 1], // ZCARD — 1 request in window
      [null, 1], // EXPIRE
    ];
    redisMock.multi.mockClear();
    multiExecMock.mockClear();
  });

  test('allows requests under the limit', async () => {
    const limiter = createUserRateLimiter({ max: 10, keyPrefix: 'rl:test:' });
    const app = createApp(limiter);

    const res = await makeRequest(app);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
  });

  test('returns 429 when limit is exceeded', async () => {
    multiResults = [
      [null, 0],
      [null, 1],
      [null, 11], // ZCARD — 11 requests, exceeds max of 10
      [null, 1],
    ];

    const limiter = createUserRateLimiter({ max: 10, keyPrefix: 'rl:test:' });
    const app = createApp(limiter);

    const res = await makeRequest(app);
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('Rate limit exceeded');
    expect(typeof body.retryAfter).toBe('number');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  test('sets X-RateLimit-Remaining to 0 when at limit', async () => {
    multiResults = [
      [null, 0],
      [null, 1],
      [null, 10], // ZCARD — exactly at max
      [null, 1],
    ];

    const limiter = createUserRateLimiter({ max: 10, keyPrefix: 'rl:test:' });
    const app = createApp(limiter);

    const res = await makeRequest(app);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  test('fails open when Redis returns null from MULTI/EXEC', async () => {
    multiResults = null;

    const limiter = createUserRateLimiter({ max: 10, keyPrefix: 'rl:test:' });
    const app = createApp(limiter);

    const res = await makeRequest(app);
    expect(res.status).toBe(200);
  });

  test('fails open when Redis throws an error', async () => {
    multiExecMock.mockImplementationOnce(async () => {
      throw new Error('Redis connection lost');
    });

    // Need to also make multi() throw since the pipeline is built before exec
    redisMock.multi.mockImplementationOnce(() => {
      throw new Error('Redis connection lost');
    });

    const limiter = createUserRateLimiter({ max: 10, keyPrefix: 'rl:test:' });
    const app = createApp(limiter);

    const res = await makeRequest(app);
    expect(res.status).toBe(200);
  });

  test('uses userId from context for the key', async () => {
    const limiter = createUserRateLimiter({ max: 10, keyPrefix: 'rl:send:' });
    const app = createApp(limiter);

    await makeRequest(app);

    // The multi() pipeline was called — verify it was invoked
    expect(redisMock.multi).toHaveBeenCalled();
  });

  test('uses configurable window size', async () => {
    const limiter = createUserRateLimiter({
      max: 5,
      windowMs: 120_000,
      keyPrefix: 'rl:custom:',
    });
    const app = createApp(limiter);

    const res = await makeRequest(app);
    expect(res.status).toBe(200);
    // Reset header should reflect the 120s window
    expect(res.headers.get('X-RateLimit-Reset')).toBe('120');
  });
});

// ---------------------------------------------------------------------------
// Tests: rateLimitMiddleware (fixed window, IP-based)
// ---------------------------------------------------------------------------

describe('rateLimitMiddleware', () => {
  beforeEach(() => {
    incrResult = 1;
    ttlResult = 60;
    redisMock.incr.mockClear();
    redisMock.expire.mockClear();
    redisMock.ttl.mockClear();
  });

  test('allows requests under the limit', async () => {
    incrResult = 1;
    const limiter = rateLimitMiddleware({ max: 100, keyPrefix: 'rl:ip:' });
    const app = new Hono();
    app.use('*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await makeRequest(app);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
  });

  test('returns 429 when limit is exceeded', async () => {
    incrResult = 101;
    const limiter = rateLimitMiddleware({ max: 100, keyPrefix: 'rl:ip:' });
    const app = new Hono();
    app.use('*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await makeRequest(app);
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('Rate limit exceeded');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  test('fails open on Redis error', async () => {
    redisMock.incr.mockImplementationOnce(async () => {
      throw new Error('Redis down');
    });

    const limiter = rateLimitMiddleware({ max: 100, keyPrefix: 'rl:ip:' });
    const app = new Hono();
    app.use('*', limiter);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await makeRequest(app);
    expect(res.status).toBe(200);
  });
});
