import { createMiddleware } from 'hono/factory';

import { validateSession } from '../auth/session-manager.js';

/**
 * Hono context variables injected by {@link authMiddleware}.
 *
 * Use this type when defining Hono apps or routes that sit behind
 * the auth middleware so that `c.get('userId')` is typed as `string`.
 *
 * @example
 * ```ts
 * const app = new Hono<{ Variables: AuthVariables }>();
 * app.use('*', authMiddleware);
 * app.get('/me', (c) => c.json({ userId: c.get('userId') }));
 * ```
 */
export type AuthVariables = {
  userId: string;
};

/**
 * Hono middleware that validates a Bearer token from the
 * `Authorization` header and injects the authenticated `userId`
 * into the Hono context.
 *
 * Requests without a valid token receive a generic 401 response.
 * The error message is intentionally vague to avoid leaking
 * information about why authentication failed (missing, expired,
 * or invalid token).
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
