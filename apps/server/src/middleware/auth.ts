import { db, users } from '@enclave/db';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';

import { validateSession } from '../auth/session-manager.js';

export type AuthVariables = {
  userId: string;
  isAdmin?: boolean;
};

export type CheckDisabledFn = (userId: string) => Promise<{ disabled: boolean } | null>;

/**
 * Hono middleware that validates a Bearer token and injects `userId`
 * into context. Requests without a valid token receive a generic 401.
 * Accounts flagged as disabled by an admin receive a 401 ACCOUNT_DISABLED.
 */
export const createAuthMiddleware = (
  validateSessionFn: typeof validateSession,
  checkDisabledFn?: CheckDisabledFn,
) =>
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

    // Check if the user account has been disabled by an admin
    if (checkDisabledFn) {
      const user = await checkDisabledFn(session.userId);
      if (user?.disabled) {
        return c.json(
          { error: 'ACCOUNT_DISABLED', message: 'Your account has been disabled' },
          401,
        );
      }
    }

    c.set('userId', session.userId);
    await next();
  });

const defaultCheckDisabled: CheckDisabledFn = async (userId) => {
  const rows = await db
    .select({ disabled: users.disabled })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0] ?? null;
};

export const authMiddleware = createAuthMiddleware(validateSession, defaultCheckDisabled);

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

// ---------------------------------------------------------------------------
// Admin enforcement
// ---------------------------------------------------------------------------

export type LookupAdminFn = (userId: string) => Promise<{ isAdmin: boolean } | null>;

export const createRequireAdminMiddleware = (lookupFn: LookupAdminFn) =>
  createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const userId = c.get('userId');
    const user = await lookupFn(userId);

    if (!user) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    if (!user.isAdmin) {
      return c.json(
        {
          error: 'ADMIN_REQUIRED',
          message: 'This action requires administrator privileges',
        },
        403,
      );
    }

    await next();
  });

const defaultAdminLookup: LookupAdminFn = async (userId) => {
  const rows = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
  return rows[0] ?? null;
};

export const requireAdmin = createRequireAdminMiddleware(defaultAdminLookup);
