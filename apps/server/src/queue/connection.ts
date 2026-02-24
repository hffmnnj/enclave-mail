import Redis from 'ioredis';

/**
 * Exponential backoff retry strategy for ioredis.
 * Caps at 10 s to prevent a retry storm from hammering the process
 * when Redis is temporarily unreachable (e.g. container restart).
 */
function retryStrategy(times: number): number {
  const delay = Math.min(100 * 2 ** times, 10_000); // 100 ms → 200 → 400 … capped at 10 s
  return delay;
}

/**
 * Create a new ioredis connection configured for BullMQ compatibility.
 *
 * BullMQ requires `maxRetriesPerRequest: null` and recommends
 * `enableReadyCheck: false`. Each BullMQ Queue and Worker must
 * receive its own dedicated connection — never share a single
 * instance across multiple queues or workers.
 *
 * @param url - Redis connection URL. Defaults to `REDIS_URL` env var
 *              or `redis://localhost:6379`.
 */
export function createRedisConnection(url?: string): Redis {
  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy,
  });

  function silenceConnectErrors(c: Redis): void {
    c.on('error', (err: Error) => {
      const msg = (err as NodeJS.ErrnoException).code ?? err.message;
      if (msg !== 'ECONNREFUSED' && msg !== 'ETIMEDOUT') {
        console.error('[redis] error:', err.message);
      }
    });
  }

  silenceConnectErrors(client);

  // BullMQ calls connection.duplicate() internally; the duplicate inherits
  // options (including retryStrategy) but NOT event listeners. Wrap duplicate
  // so every clone also gets the silent error handler.
  const originalDuplicate = client.duplicate.bind(client);
  client.duplicate = (...args: Parameters<typeof client.duplicate>): Redis => {
    const dup = originalDuplicate(...args);
    silenceConnectErrors(dup);
    return dup;
  };

  return client;
}

/**
 * Singleton Redis connection for general application use
 * (rate limiting, session storage, caching, etc.).
 *
 * Do NOT pass this instance to BullMQ queues or workers —
 * use `createRedisConnection()` to create dedicated connections.
 */
export const redis = createRedisConnection();
