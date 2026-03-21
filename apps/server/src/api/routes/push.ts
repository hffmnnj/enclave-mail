import { db, pushSubscriptions } from '@enclave/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getVapidPublicKey } from '../../lib/vapid.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { authMiddleware } from '../../middleware/auth.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const pushRouter = new Hono<{ Variables: AuthVariables }>();

// GET /api/push/vapid-key — public, returns the VAPID public key
pushRouter.get('/api/push/vapid-key', (c) => {
  try {
    const publicKey = getVapidPublicKey();
    return c.json({ publicKey });
  } catch {
    return c.json({ error: 'Push notifications not configured' }, 503);
  }
});

// POST /api/push/subscribe — stores a push subscription for the authenticated user
pushRouter.post('/api/push/subscribe', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = subscribeSchema.parse(await c.req.json());

  // Upsert: if endpoint already exists, update keys (browser may rotate them)
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

  return c.json({ ok: true }, 201);
});

// DELETE /api/push/subscribe — removes a push subscription
pushRouter.delete('/api/push/subscribe', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = unsubscribeSchema.parse(await c.req.json());

  await db
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, body.endpoint)),
    );

  return c.json({ ok: true });
});
