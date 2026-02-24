import { boolean, index, integer, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from '../types/bytea.ts';
import { users } from './users.ts';

export const prekeyTypeEnum = pgEnum('prekey_type', ['signed', 'one_time']);

export const prekeys = pgTable(
  'prekeys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyId: integer('key_id').notNull(),
    publicKey: bytea('public_key').notNull(),
    signature: bytea('signature'),
    keyType: prekeyTypeEnum('key_type').notNull(),
    isUsed: boolean('is_used').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    userTypeUsedCreatedIdx: index('prekeys_user_type_used_created_idx').on(
      table.userId,
      table.keyType,
      table.isUsed,
      table.createdAt,
    ),
  }),
);
