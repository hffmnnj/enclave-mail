import Redis from 'ioredis';

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

  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

/**
 * Singleton Redis connection for general application use
 * (rate limiting, session storage, caching, etc.).
 *
 * Do NOT pass this instance to BullMQ queues or workers —
 * use `createRedisConnection()` to create dedicated connections.
 */
export const redis = createRedisConnection();
