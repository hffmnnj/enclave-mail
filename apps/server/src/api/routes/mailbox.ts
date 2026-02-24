import { db, mailboxes, messages } from '@enclave/db';
import { and, count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import type { AuthVariables } from '../../middleware/auth.js';
import { authMiddleware, requireKeyExport } from '../../middleware/auth.js';
import type { ApiError, ApiResponse } from '../types.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createMailboxSchema = z.object({
  name: z.string().min(1).max(255).trim(),
});

// ---------------------------------------------------------------------------
// System mailbox types that cannot be deleted
// ---------------------------------------------------------------------------

const SYSTEM_MAILBOX_TYPES = new Set(['inbox', 'sent', 'drafts', 'trash', 'archive']);

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type MailboxListItem = {
  id: string;
  name: string;
  type: string;
  messageCount: number;
  unreadCount: number;
  uidNext: number;
};

type MailboxCreated = {
  id: string;
  name: string;
};

type MailboxStats = {
  total: number;
  unread: number;
  recent: number;
};

// ---------------------------------------------------------------------------
// Dependencies for testability
// ---------------------------------------------------------------------------

export interface MailboxRouteDeps {
  getDb: () => typeof db;
  middleware?: MiddlewareHandler[];
}

const defaultDeps: MailboxRouteDeps = {
  getDb: () => db,
};

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export const createMailboxRouter = (
  deps: MailboxRouteDeps = defaultDeps,
): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();
  const getDb = deps.getDb;

  // Apply auth + key export middleware to all routes (injectable for tests)
  const mw = deps.middleware ?? [authMiddleware, requireKeyExport];
  for (const handler of mw) {
    router.use('*', handler);
  }

  // -------------------------------------------------------------------------
  // GET /mailboxes — list all user mailboxes with counts
  // -------------------------------------------------------------------------

  router.get('/mailboxes', async (c) => {
    const userId = c.get('userId');

    const rows = await getDb()
      .select({
        id: mailboxes.id,
        name: mailboxes.name,
        type: mailboxes.type,
        messageCount: mailboxes.messageCount,
        unreadCount: mailboxes.unreadCount,
        uidNext: mailboxes.uidNext,
      })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId));

    const body: ApiResponse<MailboxListItem[]> = { data: rows };
    return c.json(body, 200);
  });

  // -------------------------------------------------------------------------
  // POST /mailboxes — create a custom mailbox
  // -------------------------------------------------------------------------

  router.post('/mailboxes', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      const body: ApiError = { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' };
      return c.json(body, 400);
    }

    const parsed = createMailboxSchema.safeParse(rawBody);
    if (!parsed.success) {
      const body: ApiError = {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      };
      return c.json(body, 400);
    }

    const userId = c.get('userId');
    const { name } = parsed.data;

    // Check for duplicate name within user's mailboxes
    const existing = await getDb()
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(and(eq(mailboxes.userId, userId), eq(mailboxes.name, name)));

    if (existing.length > 0) {
      const body: ApiError = { error: 'Mailbox name already exists', code: 'DUPLICATE_MAILBOX' };
      return c.json(body, 409);
    }

    const uidValidity = Math.floor(Date.now() / 1000);

    const inserted = await getDb()
      .insert(mailboxes)
      .values({
        userId,
        name,
        type: 'custom',
        uidValidity,
        uidNext: 1,
        messageCount: 0,
        unreadCount: 0,
      })
      .returning({ id: mailboxes.id, name: mailboxes.name });

    const row = inserted[0];
    if (!row) {
      const body: ApiError = { error: 'Failed to create mailbox', code: 'INTERNAL_ERROR' };
      return c.json(body, 500);
    }

    const body: ApiResponse<MailboxCreated> = { data: { id: row.id, name: row.name } };
    return c.json(body, 201);
  });

  // -------------------------------------------------------------------------
  // DELETE /mailboxes/:id — delete a custom mailbox
  // -------------------------------------------------------------------------

  router.delete('/mailboxes/:id', async (c) => {
    const userId = c.get('userId');
    const mailboxId = c.req.param('id');

    const rows = await getDb()
      .select({ id: mailboxes.id, type: mailboxes.type })
      .from(mailboxes)
      .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, userId)));

    const mailbox = rows[0];
    if (!mailbox) {
      const body: ApiError = { error: 'Mailbox not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    if (SYSTEM_MAILBOX_TYPES.has(mailbox.type)) {
      const body: ApiError = { error: 'Cannot delete system mailbox', code: 'FORBIDDEN' };
      return c.json(body, 403);
    }

    await getDb().delete(mailboxes).where(eq(mailboxes.id, mailboxId));

    return c.body(null, 204);
  });

  // -------------------------------------------------------------------------
  // GET /mailboxes/:id/stats — message counts for a mailbox
  // -------------------------------------------------------------------------

  router.get('/mailboxes/:id/stats', async (c) => {
    const userId = c.get('userId');
    const mailboxId = c.req.param('id');

    // Verify mailbox belongs to user
    const mailboxRows = await getDb()
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, userId)));

    if (mailboxRows.length === 0) {
      const body: ApiError = { error: 'Mailbox not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Count total messages
    const totalResult = await getDb()
      .select({ value: count() })
      .from(messages)
      .where(eq(messages.mailboxId, mailboxId));

    const total = totalResult[0]?.value ?? 0;

    // Count unread (messages without 'seen' flag)
    const unreadResult = await getDb()
      .select({ value: count() })
      .from(messages)
      .where(
        and(eq(messages.mailboxId, mailboxId), sql`NOT (${messages.flags} @> '"seen"'::jsonb)`),
      );

    const unread = unreadResult[0]?.value ?? 0;

    // Count recent (messages from last 24 hours)
    const recentResult = await getDb()
      .select({ value: count() })
      .from(messages)
      .where(
        and(eq(messages.mailboxId, mailboxId), sql`${messages.date} > NOW() - INTERVAL '24 hours'`),
      );

    const recent = recentResult[0]?.value ?? 0;

    const body: ApiResponse<MailboxStats> = { data: { total, unread, recent } };
    return c.json(body, 200);
  });

  return router;
};

// ---------------------------------------------------------------------------
// Default instance wired to real dependencies
// ---------------------------------------------------------------------------

export const mailboxRouter = createMailboxRouter();
