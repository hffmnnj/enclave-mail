import { desc, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from '../types/bytea.js';
import { mailboxes } from './mailboxes.js';

export const messageFlagEnum = pgEnum('message_flag', [
  'seen',
  'flagged',
  'deleted',
  'draft',
  'answered',
]);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    uid: integer('uid').notNull(),
    messageId: text('message_id'),
    inReplyTo: text('in_reply_to'),
    fromAddress: text('from_address').notNull(),
    toAddresses: jsonb('to_addresses').$type<string[]>().notNull(),
    subjectEncrypted: bytea('subject_encrypted'),
    date: timestamp('date', { withTimezone: true, mode: 'date' }).notNull(),
    flags: jsonb('flags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    size: integer('size').notNull().default(0),
    dkimStatus: text('dkim_status'),
    spfStatus: text('spf_status'),
    dmarcStatus: text('dmarc_status'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    mailboxUidUniqueIdx: uniqueIndex('messages_mailbox_uid_unique_idx').on(
      table.mailboxId,
      table.uid,
    ),
    mailboxIdx: index('messages_mailbox_idx').on(table.mailboxId),
    mailboxUidIdx: index('messages_mailbox_uid_idx').on(table.mailboxId, table.uid),
    mailboxDateDescIdx: index('messages_mailbox_date_desc_idx').on(
      table.mailboxId,
      desc(table.date),
    ),
    messageIdIdx: index('messages_message_id_idx').on(table.messageId),
  }),
);
