import type { MiddlewareHandler } from 'hono';

import { redis } from '../queue/connection.js';

/**
 * Configuration for the sliding-window rate limiter.
 */
export interface RateLimitConfig {
  /** Window size in milliseconds (default: 60_000 = 1 minute) */
  windowMs: number;
  /** Maximum requests allowed within the window (default: 100) */
  max: number;
  /** Redis key prefix (e.g. 'rl:ip:' or 'rl:user:') */
  keyPrefix: string;
  /** Custom message returned in the 429 response body */
  message?: string;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  max: 100,
  keyPrefix: 'rl:',
  message: 'Too many requests, please try again later.',
};

/**
 * Extract the client IP address from the request.
 *
 * Checks `X-Forwarded-For` first (for reverse-proxy setups like Caddy),
 * then falls back to the connecting socket address.
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    // X-Forwarded-For may contain a comma-separated list; take the first
    const first = forwarded.split(',')[0];
    return first?.trim() ?? 'unknown';
  }

  // Bun exposes the remote address on the request's underlying socket.
  // In Hono on Bun, there is no standard way to access it from the
  // Request object alone, so fall back to a safe default.
  return 'unknown';
}

/**
 * Create a Hono middleware that enforces per-key rate limiting
 * using a fixed-window counter backed by Redis (INCR + EXPIRE).
 *
 * On Redis failure the middleware **fails open** — the request is
 * allowed through and a warning is logged. This prevents a Redis
 * outage from taking down the entire API.
 */
export function rateLimitMiddleware(config?: Partial<RateLimitConfig>): MiddlewareHandler {
  const cfg: RateLimitConfig = { ...DEFAULT_CONFIG, ...config };
  const windowSeconds = Math.ceil(cfg.windowMs / 1000);

  return async (c, next) => {
    const key = `${cfg.keyPrefix}${getClientIp(c.req.raw)}`;

    try {
      const current = await redis.incr(key);

      // First request in this window — set the expiry
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      // Retrieve the TTL so we can populate the Reset header.
      // If the key has no TTL (edge case), fall back to the full window.
      const ttl = await redis.ttl(key);
      const resetSeconds = ttl > 0 ? ttl : windowSeconds;

      // Always attach informational rate-limit headers
      c.header('X-RateLimit-Limit', String(cfg.max));
      c.header('X-RateLimit-Remaining', String(Math.max(0, cfg.max - current)));
      c.header('X-RateLimit-Reset', String(resetSeconds));

      if (current > cfg.max) {
        return c.json(
          {
            error: 'Rate limit exceeded' as const,
            message: cfg.message ?? DEFAULT_CONFIG.message!,
            retryAfter: resetSeconds,
          },
          429,
          { 'Retry-After': String(resetSeconds) },
        );
      }
    } catch (err: unknown) {
      // Fail open — allow the request through on Redis errors
      const message = err instanceof Error ? err.message : 'Unknown Redis error';
      console.warn(`[rate-limit] Redis error, failing open: ${message}`);
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// Sliding-window rate limiter (user-keyed, for authenticated routes)
// ---------------------------------------------------------------------------

/**
 * Create a Hono middleware that enforces per-user rate limiting
 * using a sliding-window counter backed by Redis sorted sets.
 *
 * Algorithm (sliding window via ZREMRANGEBYSCORE + ZADD + ZCARD):
 *   1. Remove entries older than (now - windowMs) from the sorted set.
 *   2. Add the current request with timestamp as score.
 *   3. Count remaining entries — if count > max, reject with 429.
 *   4. Set TTL on the key to auto-expire stale windows.
 *
 * The key is derived from the authenticated user ID (via `c.get('userId')`).
 * If no user ID is available, falls back to client IP.
 *
 * On Redis failure the middleware **fails open**.
 */
export function createUserRateLimiter(config?: Partial<RateLimitConfig>): MiddlewareHandler {
  const cfg: RateLimitConfig = { ...DEFAULT_CONFIG, ...config };
  const windowSeconds = Math.ceil(cfg.windowMs / 1000);

  return async (c, next) => {
    // Prefer authenticated user ID; fall back to IP for unauthenticated requests
    const userId = c.get('userId') as string | undefined;
    const identifier = userId ?? getClientIp(c.req.raw);
    const key = `${cfg.keyPrefix}${identifier}`;

    try {
      const now = Date.now();
      const windowStart = now - cfg.windowMs;
      // Use a unique member to avoid collisions on same-millisecond requests
      const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

      // Atomic pipeline: prune old entries, add new, count, set TTL
      const results = await redis
        .multi()
        .zremrangebyscore(key, 0, windowStart)
        .zadd(key, now, member)
        .zcard(key)
        .expire(key, windowSeconds)
        .exec();

      // results is an array of [error, result] tuples from the MULTI/EXEC
      if (!results) {
        // MULTI/EXEC returned null — Redis issue, fail open
        await next();
        return;
      }

      // ZCARD result is at index 2
      const zcardResult = results[2];
      const count = zcardResult ? (zcardResult[1] as number) : 0;
      const remaining = Math.max(0, cfg.max - count);

      // Calculate retry-after: seconds until the oldest entry in the window expires
      const retryAfter = Math.ceil(cfg.windowMs / 1000);

      // Always attach informational rate-limit headers
      c.header('X-RateLimit-Limit', String(cfg.max));
      c.header('X-RateLimit-Remaining', String(remaining));
      c.header('X-RateLimit-Reset', String(retryAfter));

      if (count > cfg.max) {
        return c.json(
          {
            error: 'Rate limit exceeded' as const,
            retryAfter,
          },
          429,
          { 'Retry-After': String(retryAfter) },
        );
      }
    } catch (err: unknown) {
      // Fail open — allow the request through on Redis errors
      const message = err instanceof Error ? err.message : 'Unknown Redis error';
      console.warn(`[rate-limit] Redis error, failing open: ${message}`);
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// Pre-configured rate limiters
// ---------------------------------------------------------------------------

/** Per-IP rate limit: 100 requests per minute. */
export const ipRateLimit: MiddlewareHandler = rateLimitMiddleware({
  windowMs: 60_000,
  max: 100,
  keyPrefix: 'rl:ip:',
});

/** Per-user rate limit: 1 000 requests per minute. */
export const userRateLimit: MiddlewareHandler = rateLimitMiddleware({
  windowMs: 60_000,
  max: 1_000,
  keyPrefix: 'rl:user:',
});

/**
 * Strict auth-endpoint rate limit: 10 requests per minute per IP.
 * Applied to login / registration routes to mitigate brute-force attacks.
 */
export const authRateLimit: MiddlewareHandler = rateLimitMiddleware({
  windowMs: 60_000,
  max: 10,
  keyPrefix: 'rl:auth:',
  message: 'Too many authentication attempts, please try again later.',
});

// ---------------------------------------------------------------------------
// Per-route compose rate limiters (user-keyed sliding window)
// ---------------------------------------------------------------------------

/** Send endpoint: 20 requests per minute per user (configurable). */
export const sendRateLimit: MiddlewareHandler = createUserRateLimiter({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_SEND_PER_MINUTE ?? 20),
  keyPrefix: 'rl:send:',
});

/** Draft create: 30 requests per minute per user (configurable). */
export const draftCreateRateLimit: MiddlewareHandler = createUserRateLimiter({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_DRAFT_CREATE_PER_MINUTE ?? 30),
  keyPrefix: 'rl:draft:create:',
});

/** Draft update: 60 requests per minute per user (configurable). */
export const draftUpdateRateLimit: MiddlewareHandler = createUserRateLimiter({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_DRAFT_UPDATE_PER_MINUTE ?? 60),
  keyPrefix: 'rl:draft:update:',
});

/** Draft delete: 30 requests per minute per user (configurable). */
export const draftDeleteRateLimit: MiddlewareHandler = createUserRateLimiter({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_DRAFT_DELETE_PER_MINUTE ?? 30),
  keyPrefix: 'rl:draft:delete:',
});
