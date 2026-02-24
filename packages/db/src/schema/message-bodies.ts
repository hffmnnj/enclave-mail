import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '../types/bytea.js';
import { messages } from './messages.js';

export const messageBodies = pgTable(
  'message_bodies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    encryptedBody: bytea('encrypted_body').notNull(),
    contentType: text('content_type').notNull().default('text/plain'),
    encryptionMetadata: jsonb('encryption_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    messageIdUniqueIdx: uniqueIndex('message_bodies_message_id_unique_idx').on(table.messageId),
  }),
);
