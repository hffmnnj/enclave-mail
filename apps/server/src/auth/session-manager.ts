import { createHash, randomBytes } from 'node:crypto';

import { redis } from '../queue/connection.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SESSION_TTL_SECONDS = Number.parseInt(process.env.SESSION_TTL_SECONDS ?? '86400', 10);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** SHA-256 hash a raw hex token and return the hex digest. */
function hashToken(rawHex: string): string {
  return createHash('sha256').update(rawHex, 'hex').digest('hex');
}

/** Redis key for a session record, keyed by the hashed token. */
function sessionKey(tokenHash: string): string {
  return `session:${tokenHash}`;
}

/** Redis key for the per-user set of active session hashes. */
function userSessionsKey(userId: string): string {
  return `user-sessions:${userId}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload stored in Redis for each active session. */
export interface SessionData {
  userId: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new session for the given user.
 *
 * Generates a cryptographically random 32-byte token, stores its
 * SHA-256 hash in Redis alongside the session metadata, and returns
 * the raw token (hex-encoded) for the client to use as a bearer
 * credential.
 *
 * A per-user index set (`user-sessions:<userId>`) tracks all active
 * token hashes so that {@link invalidateAllSessions} can revoke them
 * in bulk.
 */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const rawBytes = randomBytes(32);
  const rawHex = rawBytes.toString('hex');
  const tokenHash = hashToken(rawHex);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1_000);

  const data: SessionData = {
    userId,
    expiresAt: expiresAt.toISOString(),
  };

  const key = sessionKey(tokenHash);

  // Store session record with TTL
  await redis.set(key, JSON.stringify(data), 'EX', SESSION_TTL_SECONDS);

  // Track the token hash in the per-user index set.
  // Give the set the same TTL so it doesn't linger forever if the
  // user never explicitly logs out.
  const userKey = userSessionsKey(userId);
  await redis.sadd(userKey, tokenHash);
  await redis.expire(userKey, SESSION_TTL_SECONDS);

  return { token: rawHex, expiresAt };
}

/**
 * Validate a raw bearer token and return the associated session.
 *
 * Returns `null` if the token is unknown or has expired.
 */
export async function validateSession(
  token: string,
): Promise<{ userId: string; expiresAt: Date } | null> {
  const tokenHash = hashToken(token);
  const raw = await redis.get(sessionKey(tokenHash));

  if (raw === null) {
    return null;
  }

  const data = JSON.parse(raw) as SessionData;
  const expiresAt = new Date(data.expiresAt);

  // Belt-and-suspenders: verify the expiry even though Redis TTL
  // should have already evicted the key.
  if (expiresAt <= new Date()) {
    await redis.del(sessionKey(tokenHash));
    return null;
  }

  return { userId: data.userId, expiresAt };
}

/**
 * Invalidate (delete) a single session by its raw bearer token.
 *
 * Idempotent — does not throw if the token has already expired or
 * been invalidated.
 */
export async function invalidateSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const key = sessionKey(tokenHash);

  // Retrieve the record so we can clean up the per-user index
  const raw = await redis.get(key);
  if (raw !== null) {
    const data = JSON.parse(raw) as SessionData;
    await redis.srem(userSessionsKey(data.userId), tokenHash);
  }

  await redis.del(key);
}

/**
 * Invalidate every active session for a user (logout all devices).
 *
 * Looks up all token hashes in the per-user index set, deletes
 * each session key, then removes the index set itself.
 *
 * Idempotent — safe to call even if the user has no active sessions.
 */
export async function invalidateAllSessions(userId: string): Promise<void> {
  const userKey = userSessionsKey(userId);
  const tokenHashes = await redis.smembers(userKey);

  if (tokenHashes.length > 0) {
    const keys = tokenHashes.map((h) => sessionKey(h));
    await redis.del(...keys);
  }

  await redis.del(userKey);
}
