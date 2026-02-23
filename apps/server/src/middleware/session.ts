import { createHash, randomBytes } from 'node:crypto';

import { redis } from '../queue/connection.js';

/** Data stored in Redis for each active session. */
export interface SessionRecord {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

/** Default session time-to-live: 24 hours. */
export const DEFAULT_SESSION_TTL_SECONDS = 86_400;

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
export async function createSession(
  userId: string,
  ttlSeconds: number = DEFAULT_SESSION_TTL_SECONDS,
): Promise<{ token: string; expiresAt: Date }> {
  const rawBytes = randomBytes(32);
  const rawHex = rawBytes.toString('hex');
  const tokenHash = hashToken(rawHex);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);

  const record: SessionRecord = {
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const key = sessionKey(tokenHash);

  // Store session record with TTL
  await redis.set(key, JSON.stringify(record), 'EX', ttlSeconds);

  // Track the token hash in the per-user index set.
  // Give the set the same TTL so it doesn't linger forever if the
  // user never explicitly logs out.
  const userKey = userSessionsKey(userId);
  await redis.sadd(userKey, tokenHash);
  await redis.expire(userKey, ttlSeconds);

  return { token: rawHex, expiresAt };
}

/**
 * Validate a raw bearer token and return the associated session.
 *
 * Returns `null` if the token is unknown or has expired.
 */
export async function validateSession(token: string): Promise<SessionRecord | null> {
  const tokenHash = hashToken(token);
  const data = await redis.get(sessionKey(tokenHash));

  if (data === null) {
    return null;
  }

  const record = JSON.parse(data) as SessionRecord;

  // Belt-and-suspenders: verify the expiry even though Redis TTL
  // should have already evicted the key.
  if (new Date(record.expiresAt) <= new Date()) {
    await redis.del(sessionKey(tokenHash));
    return null;
  }

  return record;
}

/**
 * Invalidate (delete) a single session by its raw bearer token.
 */
export async function invalidateSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const key = sessionKey(tokenHash);

  // Retrieve the record so we can clean up the per-user index
  const data = await redis.get(key);
  if (data !== null) {
    const record = JSON.parse(data) as SessionRecord;
    await redis.srem(userSessionsKey(record.userId), tokenHash);
  }

  await redis.del(key);
}

/**
 * Invalidate every active session for a user.
 *
 * Looks up all token hashes in the per-user index set, deletes
 * each session key, then removes the index set itself.
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
