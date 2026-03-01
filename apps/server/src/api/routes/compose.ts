import { Buffer } from 'node:buffer';

import { attachmentBlobs, db, mailboxes, messageBodies, messages, users } from '@enclave/db';
import type { OutboundMailJob } from '@enclave/types';
import type { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { encryptBlob, encryptMimeBody } from '../../lib/mime-encryption.js';
import type { AuthVariables } from '../../middleware/auth.js';
import { authMiddleware, requireKeyExport } from '../../middleware/auth.js';
import {
  draftCreateRateLimit,
  draftDeleteRateLimit,
  draftUpdateRateLimit,
  sendRateLimit,
} from '../../middleware/rate-limit.js';
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
  attachmentIds: z.array(z.string().uuid()).optional(),
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

const attachmentUploadSchema = z.object({
  messageId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  /** Raw file content as base64 — server encrypts at rest with AES-256-GCM */
  fileContent: z.string().min(1),
});

// Size limits for attachments
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB per file
const MAX_TOTAL_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50 MB total per message

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

type AttachmentResult = {
  id: string;
  filename: string;
  size: number;
};

type AttachmentListItem = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Dependencies for testability
// ---------------------------------------------------------------------------

export interface ComposeRouteDeps {
  getDb: () => typeof db;
  getOutboundQueue: () => Pick<Queue<OutboundMailJob>, 'add' | 'getJobs'>;
  getUserEmail: (userId: string) => Promise<string | null>;
  maxOutboundQueueDepth: number;
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

  router.post('/compose/send', sendRateLimit, async (c) => {
    const userId = c.get('userId');

    // Block unverified accounts from sending (unless verification is disabled or user is admin)
    if (process.env.REQUIRE_EMAIL_VERIFICATION !== 'false') {
      const verificationRows = await getDb()
        .select({ emailVerified: users.emailVerified, isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, userId));

      const verificationUser = verificationRows[0];
      if (verificationUser && !verificationUser.emailVerified && !verificationUser.isAdmin) {
        const body: ApiError = {
          error: 'Email not verified. Please verify your email address before sending messages.',
          code: 'EMAIL_NOT_VERIFIED',
        };
        return c.json(body, 403);
      }
    }

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

    // Check per-user outbound queue depth before enqueuing
    const queue = deps.getOutboundQueue();
    const activeJobs = await queue.getJobs(['waiting', 'active', 'delayed']);
    const userJobCount = activeJobs.filter((j) => j.data.from === userEmail).length;
    if (userJobCount >= deps.maxOutboundQueueDepth) {
      const body: ApiError = {
        error: 'Queue depth limit exceeded',
        code: 'QUEUE_DEPTH_EXCEEDED',
      };
      return c.json(body, 429);
    }

    const { encryptedMimeBody, mimeBodyNonce } = encryptMimeBody(payload.mimeBody);

    // Enqueue outbound delivery job
    await queue.add('outbound-send', {
      to: allRecipients,
      from: userEmail,
      encryptedBodyRef: messageId,
      dkimSign: true,
      encryptedMimeBody,
      mimeBodyNonce,
      attachmentIds: payload.attachmentIds?.length ? payload.attachmentIds : undefined,
    });

    const body: ApiResponse<SendResult> = {
      data: { messageId, status: 'queued' },
    };
    return c.json(body, 200);
  });

  // -------------------------------------------------------------------------
  // POST /compose/attachment — upload an encrypted attachment
  // -------------------------------------------------------------------------

  router.post('/compose/attachment', async (c) => {
    const userId = c.get('userId');

    const result = await parseJsonBody(c, attachmentUploadSchema);
    if (!result.success) {
      return c.json(result.error, 400);
    }

    const payload = result.data;

    // Decode the base64 file content to check size
    const rawBytes = Buffer.from(payload.fileContent, 'base64');
    const fileSize = rawBytes.length;

    if (fileSize > MAX_ATTACHMENT_SIZE) {
      const body: ApiError = {
        error: `Attachment exceeds maximum size of ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB`,
        code: 'ATTACHMENT_TOO_LARGE',
      };
      return c.json(body, 413);
    }

    // Verify the message belongs to the user (must be in their Drafts or Sent mailbox)
    const messageRows = await getDb()
      .select({ id: messages.id, mailboxId: messages.mailboxId })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(and(eq(messages.id, payload.messageId), eq(mailboxes.userId, userId)));

    if (messageRows.length === 0) {
      const body: ApiError = { error: 'Message not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    // Check total attachment size for this message
    const existingAttachments = await getDb()
      .select({ size: attachmentBlobs.size })
      .from(attachmentBlobs)
      .where(eq(attachmentBlobs.messageId, payload.messageId));

    const totalExistingSize = existingAttachments.reduce((sum, a) => sum + a.size, 0);
    if (totalExistingSize + fileSize > MAX_TOTAL_ATTACHMENT_SIZE) {
      const body: ApiError = {
        error: `Total attachments exceed maximum of ${MAX_TOTAL_ATTACHMENT_SIZE / (1024 * 1024)}MB`,
        code: 'TOTAL_ATTACHMENTS_TOO_LARGE',
      };
      return c.json(body, 413);
    }

    // Encrypt the file at rest with server-side AES-256-GCM key
    const { encryptedBlob: encBlob, nonce } = encryptBlob(rawBytes);

    // Store the encrypted attachment
    const inserted = await getDb()
      .insert(attachmentBlobs)
      .values({
        messageId: payload.messageId,
        filename: payload.filename,
        mimeType: payload.mimeType,
        encryptedBlob: encBlob,
        size: fileSize,
        nonce,
      })
      .returning({ id: attachmentBlobs.id });

    const row = inserted[0];
    if (!row) {
      const body: ApiError = { error: 'Failed to store attachment', code: 'INTERNAL_ERROR' };
      return c.json(body, 500);
    }

    const body: ApiResponse<AttachmentResult> = {
      data: { id: row.id, filename: payload.filename, size: fileSize },
    };
    return c.json(body, 201);
  });

  // -------------------------------------------------------------------------
  // GET /compose/attachment/:messageId — list attachments for a message
  // -------------------------------------------------------------------------

  router.get('/compose/attachment/:messageId', async (c) => {
    const userId = c.get('userId');
    const messageId = c.req.param('messageId');

    // Verify the message belongs to the user
    const messageRows = await getDb()
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(and(eq(messages.id, messageId), eq(mailboxes.userId, userId)));

    if (messageRows.length === 0) {
      const body: ApiError = { error: 'Message not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const rows = await getDb()
      .select({
        id: attachmentBlobs.id,
        filename: attachmentBlobs.filename,
        mimeType: attachmentBlobs.mimeType,
        size: attachmentBlobs.size,
        createdAt: attachmentBlobs.createdAt,
      })
      .from(attachmentBlobs)
      .where(eq(attachmentBlobs.messageId, messageId));

    const items: AttachmentListItem[] = rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      createdAt: row.createdAt.toISOString(),
    }));

    const body: ApiResponse<AttachmentListItem[]> = { data: items };
    return c.json(body, 200);
  });

  // -------------------------------------------------------------------------
  // DELETE /compose/attachment/:id — remove an attachment
  // -------------------------------------------------------------------------

  router.delete('/compose/attachment/:id', async (c) => {
    const userId = c.get('userId');
    const attachmentId = c.req.param('id');

    // Verify the attachment belongs to a message owned by the user
    const attachmentRows = await getDb()
      .select({ id: attachmentBlobs.id, messageId: attachmentBlobs.messageId })
      .from(attachmentBlobs)
      .innerJoin(messages, eq(attachmentBlobs.messageId, messages.id))
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(and(eq(attachmentBlobs.id, attachmentId), eq(mailboxes.userId, userId)));

    if (attachmentRows.length === 0) {
      const body: ApiError = { error: 'Attachment not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    await getDb().delete(attachmentBlobs).where(eq(attachmentBlobs.id, attachmentId));

    const body: ApiResponse<{ success: true }> = { data: { success: true } };
    return c.json(body, 200);
  });

  // -------------------------------------------------------------------------
  // POST /compose/draft — save a new draft
  // -------------------------------------------------------------------------

  router.post('/compose/draft', draftCreateRateLimit, async (c) => {
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

  router.put('/compose/draft/:id', draftUpdateRateLimit, async (c) => {
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

  router.delete('/compose/draft/:id', draftDeleteRateLimit, async (c) => {
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

const MAX_OUTBOUND_QUEUE_DEPTH = Number(process.env.MAX_OUTBOUND_QUEUE_DEPTH ?? 100);

export const composeRouter = createComposeRouter({
  getDb: () => db,
  getOutboundQueue,
  getUserEmail: defaultGetUserEmail,
  maxOutboundQueueDepth: MAX_OUTBOUND_QUEUE_DEPTH,
});
