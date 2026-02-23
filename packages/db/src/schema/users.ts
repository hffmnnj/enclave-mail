import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '../types/bytea.js';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  srpSalt: bytea('srp_salt').notNull(),
  srpVerifier: bytea('srp_verifier').notNull(),
  keyExportConfirmed: boolean('key_export_confirmed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
