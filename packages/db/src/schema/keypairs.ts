import { boolean, index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '../types/bytea.ts';
import { users } from './users.ts';

export const keypairTypeEnum = pgEnum('keypair_type', ['x25519', 'ed25519']);

export const keypairs = pgTable(
  'keypairs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: keypairTypeEnum('type').notNull(),
    publicKey: bytea('public_key').notNull(),
    encryptedPrivateKey: bytea('encrypted_private_key').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    userTypeActiveIdx: index('keypairs_user_type_active_idx').on(
      table.userId,
      table.type,
      table.isActive,
    ),
  }),
);
