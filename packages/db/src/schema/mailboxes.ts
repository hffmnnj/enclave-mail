import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const mailboxTypeEnum = pgEnum('mailbox_type', [
  'inbox',
  'sent',
  'drafts',
  'trash',
  'archive',
  'custom',
]);

export const mailboxes = pgTable(
  'mailboxes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: mailboxTypeEnum('type').notNull(),
    uidValidity: integer('uid_validity').notNull(),
    uidNext: integer('uid_next').notNull().default(1),
    messageCount: integer('message_count').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    userNameIdx: uniqueIndex('mailboxes_user_name_idx').on(table.userId, table.name),
    userIdx: index('mailboxes_user_idx').on(table.userId),
  }),
);
