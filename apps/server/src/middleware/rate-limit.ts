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
 * using a sliding-window counter backed by Redis.
 *
 * Algorithm (fixed-window counter via INCR + EXPIRE):
 *   1. INCR the key — atomically increments the counter.
 *   2. If the counter is 1 (first request in window), set EXPIRE.
 *   3. If the counter exceeds `max`, respond with 429.
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
            error: 'RATE_LIMIT_EXCEEDED' as const,
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
