import { db, users } from '@enclave/db';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';

import { validateSession } from '../auth/session-manager.js';

export type AuthVariables = {
  userId: string;
};

/**
 * Hono middleware that validates a Bearer token and injects `userId`
 * into context. Requests without a valid token receive a generic 401.
 */
export const createAuthMiddleware = (validateSessionFn: typeof validateSession) =>
  createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    const token = authHeader.slice(7);

    if (!token) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    const session = await validateSessionFn(token);

    if (!session) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    c.set('userId', session.userId);
    await next();
  });

export const authMiddleware = createAuthMiddleware(validateSession);

// ---------------------------------------------------------------------------
// Key export enforcement
// ---------------------------------------------------------------------------

/**
 * Lookup function signature for checking a user's key export status.
 * Returns null when the userId does not exist in the database.
 */
export type LookupKeyExportFn = (userId: string) => Promise<{ keyExportConfirmed: boolean } | null>;

/**
 * Hono middleware that gates access behind the `key_export_confirmed`
 * flag. Must be placed AFTER `authMiddleware` in the chain so that
 * `userId` is available in context.
 *
 * Usage in protected mailbox routes:
 * ```ts
 * app.get('/mailbox/*', authMiddleware, requireKeyExport, handler)
 * ```
 */
export const createRequireKeyExportMiddleware = (lookupFn: LookupKeyExportFn) =>
  createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const userId = c.get('userId');

    const user = await lookupFn(userId);

    if (!user) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    if (!user.keyExportConfirmed) {
      return c.json(
        {
          error: 'KEY_EXPORT_REQUIRED',
          message: 'You must export your encryption keys before accessing mail',
        },
        403,
      );
    }

    await next();
  });

const defaultLookup: LookupKeyExportFn = async (userId) => {
  const rows = await db
    .select({ keyExportConfirmed: users.keyExportConfirmed })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0] ?? null;
};

export const requireKeyExport = createRequireKeyExportMiddleware(defaultLookup);
