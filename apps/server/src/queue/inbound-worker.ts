import { createHash } from 'node:crypto';

import { db, keypairs, mailboxes, messageBodies, messages, users } from '@enclave/db';
import type { InboundMailJob } from '@enclave/types';
import { QUEUE_NAMES } from '@enclave/types';
import type { Job, Worker } from 'bullmq';
import { Worker as BullWorker } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';

import { publishMailboxUpdate } from '../imap/notify.js';
import { createRecipientEncryptor } from '../smtp/encrypt.js';
import { extractMailMetadata, parseRawEmail } from '../smtp/inbound.js';
import { type VerificationResult, verifyMessage } from '../smtp/verification.js';
import { createRedisConnection } from './connection.js';

export type InboundEncryptionMetadata = {
  ephemeralPublicKey: string;
  algorithm: 'x25519-chacha20poly1305';
  bodyNonce: string;
  subjectNonce: string;
};

type InboundJobContext = {
  data: InboundMailJob;
};

type RecipientRecord = {
  id: string;
  email: string;
};

type RecipientMailbox = {
  id: string;
  uidNext: number;
  messageCount: number;
};

type DeliveryInsertInput = {
  mailboxId: string;
  mailboxUidNext: number;
  messageId: string;
  inReplyTo: string | null;
  fromAddress: string;
  toAddresses: string[];
  subjectEncrypted: Buffer;
  date: Date;
  size: number;
  encryptedBody: Buffer;
  encryptionMetadata: InboundEncryptionMetadata;
  verification: VerificationResult;
};

type DeliveryStoreResult =
  | {
      status: 'stored';
      messageCount: number;
    }
  | {
      status: 'duplicate';
    };

interface InboundDataStore {
  findUserByEmail: (email: string) => Promise<RecipientRecord | null>;
  findActiveX25519PublicKey: (userId: string) => Promise<Uint8Array | null>;
  findInboxMailbox: (userId: string) => Promise<RecipientMailbox | null>;
  storeDelivery: (input: DeliveryInsertInput) => Promise<DeliveryStoreResult>;
}

interface InboundLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

type InboundWorkerDeps = {
  parseRawEmailFn: typeof parseRawEmail;
  extractMailMetadataFn: typeof extractMailMetadata;
  verifyMessageFn: typeof verifyMessage;
  dataStore: InboundDataStore;
  logger: InboundLogger;
};

export type InboundProcessResult = {
  processedRecipients: number;
  storedRecipients: number;
  duplicateRecipients: number;
  skippedRecipients: number;
  failedRecipients: number;
};

function normalizeRecipient(email: string): string {
  return email.trim().toLowerCase();
}

function fallbackMessageId(rawEmail: string): string {
  const digest = createHash('sha256').update(rawEmail).digest('hex');
  return `generated-${digest}`;
}

function encryptWithRecipientPublicKey(
  rawEmail: string,
  subject: string,
  recipientPublicKey: Uint8Array,
): {
  encryptedBody: Buffer;
  encryptedSubject: Buffer;
  encryptionMetadata: InboundEncryptionMetadata;
} {
  const encryptor = createRecipientEncryptor(recipientPublicKey);
  const encryptedBodyPayload = encryptor.encrypt(new TextEncoder().encode(rawEmail));
  const encryptedSubjectPayload = encryptor.encrypt(new TextEncoder().encode(subject));

  return {
    encryptedBody: encryptedBodyPayload.ciphertext,
    encryptedSubject: encryptedSubjectPayload.ciphertext,
    encryptionMetadata: {
      algorithm: 'x25519-chacha20poly1305',
      ephemeralPublicKey: encryptedBodyPayload.ephemeralPublicKey.toString('hex'),
      bodyNonce: encryptedBodyPayload.nonce.toString('hex'),
      subjectNonce: encryptedSubjectPayload.nonce.toString('hex'),
    },
  };
}

function createDatabaseStore(): InboundDataStore {
  return {
    async findUserByEmail(email: string): Promise<RecipientRecord | null> {
      const rows = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      return rows[0] ?? null;
    },

    async findActiveX25519PublicKey(userId: string): Promise<Uint8Array | null> {
      const rows = await db
        .select({ publicKey: keypairs.publicKey })
        .from(keypairs)
        .where(
          and(
            eq(keypairs.userId, userId),
            eq(keypairs.type, 'x25519'),
            eq(keypairs.isActive, true),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }

      return new Uint8Array(row.publicKey);
    },

    async findInboxMailbox(userId: string): Promise<RecipientMailbox | null> {
      const rows = await db
        .select({
          id: mailboxes.id,
          uidNext: mailboxes.uidNext,
          messageCount: mailboxes.messageCount,
        })
        .from(mailboxes)
        .where(and(eq(mailboxes.userId, userId), eq(mailboxes.type, 'inbox')))
        .limit(1);

      return rows[0] ?? null;
    },

    async storeDelivery(input: DeliveryInsertInput): Promise<DeliveryStoreResult> {
      return db.transaction(async (tx) => {
        const duplicates = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(eq(messages.mailboxId, input.mailboxId), eq(messages.messageId, input.messageId)),
          )
          .limit(1);

        if (duplicates.length > 0) {
          return { status: 'duplicate' };
        }

        const insertedMessages = await tx
          .insert(messages)
          .values({
            mailboxId: input.mailboxId,
            uid: input.mailboxUidNext,
            messageId: input.messageId,
            inReplyTo: input.inReplyTo,
            fromAddress: input.fromAddress,
            toAddresses: input.toAddresses,
            subjectEncrypted: input.subjectEncrypted,
            date: input.date,
            flags: [],
            size: input.size,
            dkimStatus: input.verification.dkim,
            spfStatus: input.verification.spf,
            dmarcStatus: input.verification.dmarc,
          })
          .returning({ id: messages.id });

        const insertedMessage = insertedMessages[0];
        if (!insertedMessage) {
          throw new Error(`Failed to insert inbound message for mailbox ${input.mailboxId}`);
        }

        await tx.insert(messageBodies).values({
          messageId: insertedMessage.id,
          encryptedBody: input.encryptedBody,
          contentType: 'message/rfc822-encrypted',
          encryptionMetadata: input.encryptionMetadata,
        });

        const updatedMailboxRows = await tx
          .update(mailboxes)
          .set({
            uidNext: sql`${mailboxes.uidNext} + 1`,
            messageCount: sql`${mailboxes.messageCount} + 1`,
            unreadCount: sql`${mailboxes.unreadCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(mailboxes.id, input.mailboxId))
          .returning({ messageCount: mailboxes.messageCount });

        const updatedMailbox = updatedMailboxRows[0];
        if (!updatedMailbox) {
          throw new Error(`Failed to update mailbox counters for mailbox ${input.mailboxId}`);
        }

        return { status: 'stored', messageCount: updatedMailbox.messageCount };
      });
    },
  };
}

function createDefaultDeps(overrides: Partial<InboundWorkerDeps> = {}): InboundWorkerDeps {
  return {
    parseRawEmailFn: parseRawEmail,
    extractMailMetadataFn: extractMailMetadata,
    verifyMessageFn: verifyMessage,
    dataStore: createDatabaseStore(),
    logger: {
      info: (message: string) => console.info(message),
      warn: (message: string) => console.warn(message),
      error: (message: string) => console.error(message),
    },
    ...overrides,
  };
}

export async function processInboundMailJob(
  job: InboundJobContext,
  overrides: Partial<InboundWorkerDeps> = {},
): Promise<InboundProcessResult> {
  const deps = createDefaultDeps(overrides);

  const parsed = await deps.parseRawEmailFn(job.data.rawEmail);
  const metadata = deps.extractMailMetadataFn(parsed);
  const verification = await deps.verifyMessageFn(job.data.rawEmail, job.data.sourceIp);

  const resolvedMessageId = metadata.messageId || fallbackMessageId(job.data.rawEmail);

  const result: InboundProcessResult = {
    processedRecipients: metadata.to.length,
    storedRecipients: 0,
    duplicateRecipients: 0,
    skippedRecipients: 0,
    failedRecipients: 0,
  };

  for (const recipientAddress of metadata.to) {
    const normalizedRecipient = normalizeRecipient(recipientAddress);

    try {
      const user = await deps.dataStore.findUserByEmail(normalizedRecipient);
      if (!user) {
        deps.logger.warn(`Skipping inbound recipient ${normalizedRecipient}: no local user found`);
        result.skippedRecipients += 1;
        continue;
      }

      const recipientPublicKey = await deps.dataStore.findActiveX25519PublicKey(user.id);
      if (!recipientPublicKey) {
        deps.logger.warn(`Skipping inbound recipient ${normalizedRecipient}: no active X25519 key`);
        result.skippedRecipients += 1;
        continue;
      }

      const inboxMailbox = await deps.dataStore.findInboxMailbox(user.id);
      if (!inboxMailbox) {
        deps.logger.warn(
          `Skipping inbound recipient ${normalizedRecipient}: INBOX mailbox missing`,
        );
        result.skippedRecipients += 1;
        continue;
      }

      const encryptedPayload = encryptWithRecipientPublicKey(
        job.data.rawEmail,
        metadata.subject,
        recipientPublicKey,
      );

      const storeResult = await deps.dataStore.storeDelivery({
        mailboxId: inboxMailbox.id,
        mailboxUidNext: inboxMailbox.uidNext,
        messageId: resolvedMessageId,
        inReplyTo: metadata.inReplyTo,
        fromAddress: metadata.from,
        toAddresses: [normalizedRecipient],
        subjectEncrypted: encryptedPayload.encryptedSubject,
        date: metadata.date,
        size: metadata.size,
        encryptedBody: encryptedPayload.encryptedBody,
        encryptionMetadata: encryptedPayload.encryptionMetadata,
        verification,
      });

      if (storeResult.status === 'duplicate') {
        deps.logger.info(
          `Skipping duplicate inbound message ${resolvedMessageId} for ${normalizedRecipient}`,
        );
        result.duplicateRecipients += 1;
        continue;
      }

      result.storedRecipients += 1;
      publishMailboxUpdate(inboxMailbox.id, storeResult.messageCount);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.error(`Failed inbound delivery for recipient ${normalizedRecipient}: ${message}`);
      result.failedRecipients += 1;
    }
  }

  return result;
}

export function startInboundWorker(
  overrides: Partial<InboundWorkerDeps> = {},
): Worker<InboundMailJob> {
  const deps = createDefaultDeps(overrides);

  return new BullWorker<InboundMailJob>(
    QUEUE_NAMES.INBOUND_MAIL,
    async (job: Job<InboundMailJob>) => {
      await processInboundMailJob(
        {
          data: job.data,
        },
        deps,
      );
    },
    {
      connection: createRedisConnection(),
    },
  );
}
