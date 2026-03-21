import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '../types/bytea.ts';
import { messages } from './messages.ts';

/**
 * Stores file attachments for outbound messages.
 *
 * The `encryptedBlob` is encrypted at rest with the server-side AES-256-GCM key
 * (same key used for mimeBody encryption). The server decrypts the blob at SMTP
 * send time to assemble multipart/mixed MIME, then purges after delivery.
 *
 * This follows the same architectural pattern as mimeBody: the server must relay
 * attachments via standard SMTP, so it needs transient access to the raw bytes.
 */
export const attachmentBlobs = pgTable(
  'attachment_blobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull().default('application/octet-stream'),
    /** Encrypted with server-side AES-256-GCM key (MIME_ENCRYPTION_KEY) */
    encryptedBlob: bytea('encrypted_blob').notNull(),
    /** Original file size in bytes (before encryption) */
    size: integer('size').notNull(),
    /** AES-256-GCM nonce (base64) for decrypting encryptedBlob */
    nonce: text('nonce').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    messageIdIdx: index('attachment_blobs_message_id_idx').on(table.messageId),
  }),
);
