import { Buffer } from 'node:buffer';

import { db, mailboxes, messageBodies, messages } from '@enclave/db';
import type { OutboundMailJob } from '@enclave/types';
import type { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { encryptMimeBody } from '../../lib/mime-encryption.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { authMiddleware, requireKeyExport } from '../../middleware/auth.js';
import type { ApiError, ApiResponse } from '../types.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const encryptionMetadataSchema = z.object({
  algorithm: z.string().min(1),
  recipientKeyFingerprints: z.array(z.string()).optional(),
  version: z.number().int().positive().optional(),
});

const sendSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  encryptedSubject: z.string().min(1),
  encryptedBody: z.string().min(1),
  mimeBody: z.string().min(1),
  encryptionMetadata: encryptionMetadataSchema,
});

const draftCreateSchema = z.object({
  to: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
  encryptedBody: z.string().optional(),
  encryptionMetadata: encryptionMetadataSchema.optional(),
});

const draftUpdateSchema = z.object({
  to: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
  encryptedBody: z.string().optional(),
  encryptionMetadata: encryptionMetadataSchema.optional(),
});

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type SendResult = {
  messageId: string;
  status: 'queued';
};

type DraftResult = {
  id: string;
};

type DraftListItem = {
  id: string;
  to: string[];
  subject: string | null;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Dependencies for testability
// ---------------------------------------------------------------------------

export interface ComposeRouteDeps {
  getDb: () => typeof db;
  getOutboundQueue: () => Pick<Queue<OutboundMailJob>, 'add'>;
  getUserEmail: (userId: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parseJsonBody = async <TSchema extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  schema: TSchema,
): Promise<{ success: true; data: z.infer<TSchema> } | { success: false; error: ApiError }> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      success: false,
      error: { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.issues },
    };
  }

  return { success: true, data: parsed.data };
};

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export const createComposeRouter = (deps: ComposeRouteDeps): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();
  const getDb = deps.getDb;

  // Apply auth + key export middleware to all routes
  router.use('*', authMiddleware, requireKeyExport);

  // -------------------------------------------------------------------------
  // POST /compose/send — encrypt + store in Sent + queue outbound
  // -------------------------------------------------------------------------

  router.post('/compose/send', async (c) => {
    const userId = c.get('userId');

    const result = await parseJsonBody(c, sendSchema);
    if (!result.success) {
      return c.json(result.error, 400);
    }

    const payload = result.data;

    // Look up user email for the "from" address
    const userEmail = await deps.getUserEmail(userId);
    if (!userEmail) {
      const body: ApiError = { error: 'User not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Look up user's Sent mailbox
    const sentRows = await getDb()
      .select({ id: mailboxes.id, uidNext: mailboxes.uidNext })
      .from(mailboxes)
      .where(and(eq(mailboxes.userId, userId), eq(mailboxes.type, 'sent')));

    const sentMailbox = sentRows[0];
    if (!sentMailbox) {
      const body: ApiError = { error: 'Sent mailbox not found', code: 'MAILBOX_NOT_FOUND' };
      return c.json(body, 500);
    }

    // Collect all recipients for the to_addresses field
    const allRecipients = [...payload.to, ...(payload.cc ?? []), ...(payload.bcc ?? [])];

    // Store message in Sent mailbox within a transaction
    const encryptedSubjectBytes = Buffer.from(payload.encryptedSubject, 'base64');
    const encryptedBodyBytes = Buffer.from(payload.encryptedBody, 'base64');
    const now = new Date();

    let messageId: string | undefined;

    await getDb().transaction(async (tx) => {
      const inserted = await tx
        .insert(messages)
        .values({
          mailboxId: sentMailbox.id,
          uid: sentMailbox.uidNext,
          fromAddress: userEmail,
          toAddresses: allRecipients,
          subjectEncrypted: encryptedSubjectBytes,
          date: now,
          flags: ['seen'],
          size: encryptedBodyBytes.length,
        })
        .returning({ id: messages.id });

      const row = inserted[0];
      if (!row) {
        throw new Error('Failed to insert message');
      }

      messageId = row.id;

      await tx.insert(messageBodies).values({
        messageId: row.id,
        encryptedBody: encryptedBodyBytes,
        contentType: 'application/octet-stream',
        encryptionMetadata: payload.encryptionMetadata,
      });

      // Increment Sent mailbox counters
      await tx
        .update(mailboxes)
        .set({
          uidNext: sql`${mailboxes.uidNext} + 1`,
          messageCount: sql`${mailboxes.messageCount} + 1`,
          updatedAt: now,
        })
        .where(eq(mailboxes.id, sentMailbox.id));
    });

    if (!messageId) {
      const body: ApiError = { error: 'Failed to store message', code: 'INTERNAL_ERROR' };
      return c.json(body, 500);
    }

    const { encryptedMimeBody, mimeBodyNonce } = encryptMimeBody(payload.mimeBody);

    // Enqueue outbound delivery job
    await deps.getOutboundQueue().add('outbound-send', {
      to: allRecipients,
      from: userEmail,
      encryptedBodyRef: messageId,
      dkimSign: true,
      encryptedMimeBody,
      mimeBodyNonce,
    });

    const body: ApiResponse<SendResult> = {
      data: { messageId, status: 'queued' },
    };
    return c.json(body, 200);
  });

  // -------------------------------------------------------------------------
  // POST /compose/draft — save a new draft
  // -------------------------------------------------------------------------

  router.post('/compose/draft', async (c) => {
    const userId = c.get('userId');

    const result = await parseJsonBody(c, draftCreateSchema);
    if (!result.success) {
      return c.json(result.error, 400);
    }

    const payload = result.data;

    // Look up user email for the "from" address
    const userEmail = await deps.getUserEmail(userId);
    if (!userEmail) {
      const body: ApiError = { error: 'User not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Look up user's Drafts mailbox
    const draftRows = await getDb()
      .select({ id: mailboxes.id, uidNext: mailboxes.uidNext })
      .from(mailboxes)
      .where(and(eq(mailboxes.userId, userId), eq(mailboxes.type, 'drafts')));

    const draftMailbox = draftRows[0];
    if (!draftMailbox) {
      const body: ApiError = { error: 'Drafts mailbox not found', code: 'MAILBOX_NOT_FOUND' };
      return c.json(body, 500);
    }

    const now = new Date();
    const subjectBytes = payload.subject ? Buffer.from(payload.subject, 'utf8') : null;
    const bodyBytes = payload.encryptedBody
      ? Buffer.from(payload.encryptedBody, 'base64')
      : Buffer.alloc(0);

    let draftId: string | undefined;

    await getDb().transaction(async (tx) => {
      const inserted = await tx
        .insert(messages)
        .values({
          mailboxId: draftMailbox.id,
          uid: draftMailbox.uidNext,
          fromAddress: userEmail,
          toAddresses: payload.to ?? [],
          subjectEncrypted: subjectBytes,
          date: now,
          flags: ['draft'],
          size: bodyBytes.length,
        })
        .returning({ id: messages.id });

      const row = inserted[0];
      if (!row) {
        throw new Error('Failed to insert draft');
      }

      draftId = row.id;

      await tx.insert(messageBodies).values({
        messageId: row.id,
        encryptedBody: bodyBytes,
        contentType: 'application/octet-stream',
        encryptionMetadata: payload.encryptionMetadata ?? {},
      });

      // Increment Drafts mailbox counters
      await tx
        .update(mailboxes)
        .set({
          uidNext: sql`${mailboxes.uidNext} + 1`,
          messageCount: sql`${mailboxes.messageCount} + 1`,
          updatedAt: now,
        })
        .where(eq(mailboxes.id, draftMailbox.id));
    });

    if (!draftId) {
      const body: ApiError = { error: 'Failed to save draft', code: 'INTERNAL_ERROR' };
      return c.json(body, 500);
    }

    const body: ApiResponse<DraftResult> = { data: { id: draftId } };
    return c.json(body, 201);
  });

  // -------------------------------------------------------------------------
  // GET /compose/drafts — list drafts (convenience alias)
  // -------------------------------------------------------------------------

  router.get('/compose/drafts', async (c) => {
    const userId = c.get('userId');

    // Look up user's Drafts mailbox
    const draftRows = await getDb()
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(and(eq(mailboxes.userId, userId), eq(mailboxes.type, 'drafts')));

    const draftMailbox = draftRows[0];
    if (!draftMailbox) {
      const body: ApiResponse<DraftListItem[]> = { data: [] };
      return c.json(body, 200);
    }

    const rows = await getDb()
      .select({
        id: messages.id,
        toAddresses: messages.toAddresses,
        subjectEncrypted: messages.subjectEncrypted,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .where(eq(messages.mailboxId, draftMailbox.id))
      .orderBy(sql`${messages.updatedAt} DESC`);

    const drafts: DraftListItem[] = rows.map((row) => ({
      id: row.id,
      to: row.toAddresses,
      subject: row.subjectEncrypted ? Buffer.from(row.subjectEncrypted).toString('utf8') : null,
      updatedAt: row.updatedAt.toISOString(),
    }));

    const body: ApiResponse<DraftListItem[]> = { data: drafts };
    return c.json(body, 200);
  });

  // -------------------------------------------------------------------------
  // PUT /compose/draft/:id — update a draft
  // -------------------------------------------------------------------------

  router.put('/compose/draft/:id', async (c) => {
    const userId = c.get('userId');
    const draftId = c.req.param('id');

    const result = await parseJsonBody(c, draftUpdateSchema);
    if (!result.success) {
      return c.json(result.error, 400);
    }

    const payload = result.data;

    // Verify draft belongs to user's Drafts mailbox
    const draftRows = await getDb()
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(and(eq(mailboxes.userId, userId), eq(mailboxes.type, 'drafts')));

    const draftMailbox = draftRows[0];
    if (!draftMailbox) {
      const body: ApiError = { error: 'Draft not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const messageRows = await getDb()
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, draftId), eq(messages.mailboxId, draftMailbox.id)));

    if (messageRows.length === 0) {
      const body: ApiError = { error: 'Draft not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const now = new Date();

    // Build update set for messages table
    const messageUpdate: Record<string, unknown> = { updatedAt: now };
    if (payload.to !== undefined) {
      messageUpdate.toAddresses = payload.to;
    }
    if (payload.subject !== undefined) {
      messageUpdate.subjectEncrypted = Buffer.from(payload.subject, 'utf8');
    }

    await getDb().update(messages).set(messageUpdate).where(eq(messages.id, draftId));

    // Update body if provided
    if (payload.encryptedBody !== undefined) {
      const bodyBytes = Buffer.from(payload.encryptedBody, 'base64');
      const bodyUpdate: Record<string, unknown> = { encryptedBody: bodyBytes };
      if (payload.encryptionMetadata !== undefined) {
        bodyUpdate.encryptionMetadata = payload.encryptionMetadata;
      }
      await getDb()
        .update(messageBodies)
        .set(bodyUpdate)
        .where(eq(messageBodies.messageId, draftId));
    } else if (payload.encryptionMetadata !== undefined) {
      await getDb()
        .update(messageBodies)
        .set({ encryptionMetadata: payload.encryptionMetadata })
        .where(eq(messageBodies.messageId, draftId));
    }

    const body: ApiResponse<DraftResult> = { data: { id: draftId } };
    return c.json(body, 200);
  });

  // -------------------------------------------------------------------------
  // DELETE /compose/draft/:id — hard delete a draft
  // -------------------------------------------------------------------------

  router.delete('/compose/draft/:id', async (c) => {
    const userId = c.get('userId');
    const draftId = c.req.param('id');

    // Verify draft belongs to user's Drafts mailbox
    const draftRows = await getDb()
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(and(eq(mailboxes.userId, userId), eq(mailboxes.type, 'drafts')));

    const draftMailbox = draftRows[0];
    if (!draftMailbox) {
      const body: ApiError = { error: 'Draft not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const messageRows = await getDb()
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, draftId), eq(messages.mailboxId, draftMailbox.id)));

    if (messageRows.length === 0) {
      const body: ApiError = { error: 'Draft not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Hard delete — cascade will remove message_bodies
    await getDb().delete(messages).where(eq(messages.id, draftId));

    // Decrement Drafts mailbox counter
    await getDb()
      .update(mailboxes)
      .set({
        messageCount: sql`GREATEST(${mailboxes.messageCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(mailboxes.id, draftMailbox.id));

    const body: ApiResponse<{ success: true }> = { data: { success: true } };
    return c.json(body, 200);
  });

  return router;
};

// ---------------------------------------------------------------------------
// Default instance wired to real dependencies
// ---------------------------------------------------------------------------

import { users } from '@enclave/db';
import { createOutboundMailQueue } from '../../queue/mail-queue.js';

const defaultGetUserEmail = async (userId: string): Promise<string | null> => {
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return rows[0]?.email ?? null;
};

let outboundQueueInstance: Queue<OutboundMailJob> | undefined;

const getOutboundQueue = (): Queue<OutboundMailJob> => {
  if (!outboundQueueInstance) {
    outboundQueueInstance = createOutboundMailQueue();
  }
  return outboundQueueInstance;
};

export const composeRouter = createComposeRouter({
  getDb: () => db,
  getOutboundQueue,
  getUserEmail: defaultGetUserEmail,
});
