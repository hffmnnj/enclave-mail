import { Buffer } from 'node:buffer';

import { db, mailboxes, messageBodies, messages } from '@enclave/db';
import { type SQL, and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import type { AuthVariables } from '../../middleware/auth.js';
import { authMiddleware, requireKeyExport } from '../../middleware/auth.js';
import type { ApiError, ApiResponse, PaginatedResponse } from '../types.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(200).optional(),
  seen: z.enum(['true', 'false']).optional(),
  flagged: z.enum(['true', 'false']).optional(),
});

const updateFlagsSchema = z.object({
  flags: z.object({
    seen: z.boolean().optional(),
    flagged: z.boolean().optional(),
    deleted: z.boolean().optional(),
    draft: z.boolean().optional(),
  }),
});

const moveMessageSchema = z.object({
  targetMailboxId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type MessageFlags = {
  seen: boolean;
  flagged: boolean;
  deleted: boolean;
  draft: boolean;
};

type MessageListItem = {
  id: string;
  uid: number;
  messageId: string | null;
  fromAddress: string;
  toAddresses: string[];
  subjectEncrypted: string | null;
  date: string;
  flags: MessageFlags;
  size: number;
  dkimStatus: string | null;
  spfStatus: string | null;
  dmarcStatus: string | null;
};

type MessageBody = {
  encryptedBody: string;
  contentType: string;
  encryptionMetadata: Record<string, unknown>;
};

type FullMessage = MessageListItem & {
  body: MessageBody | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a string[] flags array from DB to a structured flags object. */
const flagsArrayToObject = (flagsArr: string[]): MessageFlags => ({
  seen: flagsArr.includes('seen'),
  flagged: flagsArr.includes('flagged'),
  deleted: flagsArr.includes('deleted'),
  draft: flagsArr.includes('draft'),
});

/** Convert a structured flags update into a string[] for DB storage. */
const mergeFlags = (
  existing: string[],
  update: {
    seen?: boolean | undefined;
    flagged?: boolean | undefined;
    deleted?: boolean | undefined;
    draft?: boolean | undefined;
  },
): string[] => {
  const flagSet = new Set(existing);

  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (value) {
      flagSet.add(key);
    } else {
      flagSet.delete(key);
    }
  }

  return [...flagSet];
};

/** Encode Uint8Array to base64 string. */
const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** Map a DB message row to a MessageListItem response. */
const toMessageListItem = (row: {
  id: string;
  uid: number;
  messageId: string | null;
  fromAddress: string;
  toAddresses: string[];
  subjectEncrypted: Uint8Array | null;
  date: Date;
  flags: string[];
  size: number;
  dkimStatus: string | null;
  spfStatus: string | null;
  dmarcStatus: string | null;
}): MessageListItem => ({
  id: row.id,
  uid: row.uid,
  messageId: row.messageId,
  fromAddress: row.fromAddress,
  toAddresses: row.toAddresses,
  subjectEncrypted: row.subjectEncrypted ? toBase64(row.subjectEncrypted) : null,
  date: row.date.toISOString(),
  flags: flagsArrayToObject(row.flags),
  size: row.size,
  dkimStatus: row.dkimStatus,
  spfStatus: row.spfStatus,
  dmarcStatus: row.dmarcStatus,
});

// ---------------------------------------------------------------------------
// Dependencies for testability
// ---------------------------------------------------------------------------

export interface MessageRouteDeps {
  getDb: () => typeof db;
  middleware?: MiddlewareHandler[];
}

const defaultDeps: MessageRouteDeps = {
  getDb: () => db,
};

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export const createMessageRouter = (
  deps: MessageRouteDeps = defaultDeps,
): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();
  const getDb = deps.getDb;

  // Apply auth + key export middleware to all routes (injectable for tests)
  const mw = deps.middleware ?? [authMiddleware, requireKeyExport];
  for (const handler of mw) {
    router.use('*', handler);
  }

  // -------------------------------------------------------------------------
  // GET /mailboxes/:id/messages — paginated message list (metadata only)
  // -------------------------------------------------------------------------

  router.get('/mailboxes/:id/messages', async (c) => {
    const userId = c.get('userId');
    const mailboxId = c.req.param('id');

    // Validate pagination + filter params
    const queryParsed = paginationSchema.safeParse({
      offset: c.req.query('offset'),
      limit: c.req.query('limit'),
      search: c.req.query('search'),
      seen: c.req.query('seen'),
      flagged: c.req.query('flagged'),
    });

    if (!queryParsed.success) {
      const body: ApiError = {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: queryParsed.error.issues,
      };
      return c.json(body, 400);
    }

    const { offset, limit, search, seen, flagged } = queryParsed.data;

    // Verify mailbox belongs to user
    const mailboxRows = await getDb()
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, userId)));

    if (mailboxRows.length === 0) {
      const body: ApiError = { error: 'Mailbox not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Build filter conditions
    const conditions: SQL[] = [eq(messages.mailboxId, mailboxId)];

    // Search: match fromAddress or any toAddresses entry (JSONB array)
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(messages.fromAddress, pattern),
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${messages.toAddresses}) AS addr WHERE addr ILIKE ${pattern})`,
        )!,
      );
    }

    // Filter by seen/unseen (flags is a JSONB array of strings)
    if (seen === 'true') {
      conditions.push(sql`${messages.flags} @> '"seen"'::jsonb`);
    } else if (seen === 'false') {
      conditions.push(sql`NOT (${messages.flags} @> '"seen"'::jsonb)`);
    }

    // Filter by flagged
    if (flagged === 'true') {
      conditions.push(sql`${messages.flags} @> '"flagged"'::jsonb`);
    } else if (flagged === 'false') {
      conditions.push(sql`NOT (${messages.flags} @> '"flagged"'::jsonb)`);
    }

    const whereClause = and(...conditions);

    // Get total count (with filters applied)
    const totalResult = await getDb()
      .select({ value: sql<number>`count(*)::int` })
      .from(messages)
      .where(whereClause);

    const total = totalResult[0]?.value ?? 0;

    // Get paginated messages (metadata only, no body)
    const rows = await getDb()
      .select({
        id: messages.id,
        uid: messages.uid,
        messageId: messages.messageId,
        fromAddress: messages.fromAddress,
        toAddresses: messages.toAddresses,
        subjectEncrypted: messages.subjectEncrypted,
        date: messages.date,
        flags: messages.flags,
        size: messages.size,
        dkimStatus: messages.dkimStatus,
        spfStatus: messages.spfStatus,
        dmarcStatus: messages.dmarcStatus,
      })
      .from(messages)
      .where(whereClause)
      .orderBy(desc(messages.date))
      .offset(offset)
      .limit(limit);

    const data = rows.map(toMessageListItem);

    const body: PaginatedResponse<MessageListItem> = { data, total, offset, limit };
    return c.json(body, 200);
  });

  // -------------------------------------------------------------------------
  // GET /messages/:id — full message with encrypted body
  // -------------------------------------------------------------------------

  router.get('/messages/:id', async (c) => {
    const userId = c.get('userId');
    const messageId = c.req.param('id');

    // Fetch message with a join to verify ownership through mailbox
    const rows = await getDb()
      .select({
        id: messages.id,
        uid: messages.uid,
        messageId: messages.messageId,
        fromAddress: messages.fromAddress,
        toAddresses: messages.toAddresses,
        subjectEncrypted: messages.subjectEncrypted,
        date: messages.date,
        flags: messages.flags,
        size: messages.size,
        dkimStatus: messages.dkimStatus,
        spfStatus: messages.spfStatus,
        dmarcStatus: messages.dmarcStatus,
        mailboxUserId: mailboxes.userId,
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(eq(messages.id, messageId));

    const row = rows[0];
    if (!row || row.mailboxUserId !== userId) {
      const body: ApiError = { error: 'Message not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Fetch message body
    const bodyRows = await getDb()
      .select({
        encryptedBody: messageBodies.encryptedBody,
        contentType: messageBodies.contentType,
        encryptionMetadata: messageBodies.encryptionMetadata,
      })
      .from(messageBodies)
      .where(eq(messageBodies.messageId, messageId));

    const bodyRow = bodyRows[0];
    const messageBody: MessageBody | null = bodyRow
      ? {
          encryptedBody: toBase64(bodyRow.encryptedBody),
          contentType: bodyRow.contentType,
          encryptionMetadata: bodyRow.encryptionMetadata,
        }
      : null;

    const fullMessage: FullMessage = {
      ...toMessageListItem(row),
      body: messageBody,
    };

    const responseBody: ApiResponse<FullMessage> = { data: fullMessage };
    return c.json(responseBody, 200);
  });

  // -------------------------------------------------------------------------
  // PATCH /messages/:id/flags — update message flags
  // -------------------------------------------------------------------------

  router.patch('/messages/:id/flags', async (c) => {
    const userId = c.get('userId');
    const messageId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      const body: ApiError = { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' };
      return c.json(body, 400);
    }

    const parsed = updateFlagsSchema.safeParse(rawBody);
    if (!parsed.success) {
      const body: ApiError = {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      };
      return c.json(body, 400);
    }

    // Verify message belongs to user
    const rows = await getDb()
      .select({
        id: messages.id,
        flags: messages.flags,
        mailboxUserId: mailboxes.userId,
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(eq(messages.id, messageId));

    const row = rows[0];
    if (!row || row.mailboxUserId !== userId) {
      const body: ApiError = { error: 'Message not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const updatedFlags = mergeFlags(row.flags, parsed.data.flags);

    await getDb()
      .update(messages)
      .set({ flags: updatedFlags, updatedAt: new Date() })
      .where(eq(messages.id, messageId));

    // Update unread count on the mailbox
    const wasSeen = row.flags.includes('seen');
    const isNowSeen = updatedFlags.includes('seen');

    if (wasSeen !== isNowSeen) {
      const mailboxRow = await getDb()
        .select({ mailboxId: messages.mailboxId })
        .from(messages)
        .where(eq(messages.id, messageId));

      const mboxId = mailboxRow[0]?.mailboxId;
      if (mboxId) {
        const delta = isNowSeen ? -1 : 1;
        await getDb()
          .update(mailboxes)
          .set({
            unreadCount: sql`GREATEST(${mailboxes.unreadCount} + ${delta}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(mailboxes.id, mboxId));
      }
    }

    const responseBody: ApiResponse<{ flags: MessageFlags }> = {
      data: { flags: flagsArrayToObject(updatedFlags) },
    };
    return c.json(responseBody, 200);
  });

  // -------------------------------------------------------------------------
  // DELETE /messages/:id — move to trash or permanent delete
  // -------------------------------------------------------------------------

  router.delete('/messages/:id', async (c) => {
    const userId = c.get('userId');
    const messageId = c.req.param('id');

    // Fetch message with mailbox info
    const rows = await getDb()
      .select({
        id: messages.id,
        mailboxId: messages.mailboxId,
        mailboxUserId: mailboxes.userId,
        mailboxType: mailboxes.type,
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(eq(messages.id, messageId));

    const row = rows[0];
    if (!row || row.mailboxUserId !== userId) {
      const body: ApiError = { error: 'Message not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    if (row.mailboxType === 'trash') {
      // Permanent delete — message is already in trash
      await getDb().delete(messages).where(eq(messages.id, messageId));

      // Decrement message count on trash mailbox
      await getDb()
        .update(mailboxes)
        .set({
          messageCount: sql`GREATEST(${mailboxes.messageCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(mailboxes.id, row.mailboxId));

      return c.body(null, 204);
    }

    // Move to trash
    const trashRows = await getDb()
      .select({ id: mailboxes.id, uidNext: mailboxes.uidNext })
      .from(mailboxes)
      .where(and(eq(mailboxes.userId, userId), eq(mailboxes.type, 'trash')));

    const trashMailbox = trashRows[0];
    if (!trashMailbox) {
      const body: ApiError = { error: 'Trash mailbox not found', code: 'INTERNAL_ERROR' };
      return c.json(body, 500);
    }

    // Assign new UID in trash mailbox
    const newUid = trashMailbox.uidNext;

    await getDb()
      .update(messages)
      .set({
        mailboxId: trashMailbox.id,
        uid: newUid,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, messageId));

    // Update source mailbox counts
    await getDb()
      .update(mailboxes)
      .set({
        messageCount: sql`GREATEST(${mailboxes.messageCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(mailboxes.id, row.mailboxId));

    // Update trash mailbox counts and uidNext
    await getDb()
      .update(mailboxes)
      .set({
        messageCount: sql`${mailboxes.messageCount} + 1`,
        uidNext: newUid + 1,
        updatedAt: new Date(),
      })
      .where(eq(mailboxes.id, trashMailbox.id));

    return c.body(null, 204);
  });

  // -------------------------------------------------------------------------
  // POST /messages/:id/move — move message to another mailbox
  // -------------------------------------------------------------------------

  router.post('/messages/:id/move', async (c) => {
    const userId = c.get('userId');
    const messageId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      const body: ApiError = { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' };
      return c.json(body, 400);
    }

    const parsed = moveMessageSchema.safeParse(rawBody);
    if (!parsed.success) {
      const body: ApiError = {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      };
      return c.json(body, 400);
    }

    const { targetMailboxId } = parsed.data;

    // Verify message belongs to user
    const msgRows = await getDb()
      .select({
        id: messages.id,
        mailboxId: messages.mailboxId,
        mailboxUserId: mailboxes.userId,
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(eq(messages.id, messageId));

    const msgRow = msgRows[0];
    if (!msgRow || msgRow.mailboxUserId !== userId) {
      const body: ApiError = { error: 'Message not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Verify target mailbox belongs to user
    const targetRows = await getDb()
      .select({ id: mailboxes.id, uidNext: mailboxes.uidNext })
      .from(mailboxes)
      .where(and(eq(mailboxes.id, targetMailboxId), eq(mailboxes.userId, userId)));

    const targetMailbox = targetRows[0];
    if (!targetMailbox) {
      const body: ApiError = { error: 'Target mailbox not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Same mailbox — no-op
    if (msgRow.mailboxId === targetMailboxId) {
      return c.body(null, 204);
    }

    // Assign new UID in target mailbox
    const newUid = targetMailbox.uidNext;

    await getDb()
      .update(messages)
      .set({
        mailboxId: targetMailboxId,
        uid: newUid,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, messageId));

    // Update source mailbox counts
    await getDb()
      .update(mailboxes)
      .set({
        messageCount: sql`GREATEST(${mailboxes.messageCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(mailboxes.id, msgRow.mailboxId));

    // Update target mailbox counts and uidNext
    await getDb()
      .update(mailboxes)
      .set({
        messageCount: sql`${mailboxes.messageCount} + 1`,
        uidNext: newUid + 1,
        updatedAt: new Date(),
      })
      .where(eq(mailboxes.id, targetMailboxId));

    return c.body(null, 204);
  });

  return router;
};

// ---------------------------------------------------------------------------
// Default instance wired to real dependencies
// ---------------------------------------------------------------------------

export const messageRouter = createMessageRouter();
