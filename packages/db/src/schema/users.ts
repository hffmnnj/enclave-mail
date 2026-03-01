import { sql } from 'drizzle-orm';
import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '../types/bytea.ts';

/**
 * Shape of the `preferences` jsonb column.
 *
 * Validated at the API layer via Zod; the DB stores the raw object.
 */
export interface UserPreferencesRecord {
  displayName?: string;
  signature?: string;
  theme?: 'dark' | 'light' | 'system';
  notificationsEnabled?: boolean;
  autoMarkRead?: boolean;
  messagesPerPage?: number;
}

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  srpSalt: bytea('srp_salt').notNull(),
  srpVerifier: bytea('srp_verifier').notNull(),
  keyExportConfirmed: boolean('key_export_confirmed').notNull().default(false),
  isAdmin: boolean('is_admin').notNull().default(false),
  emailVerified: boolean('email_verified').notNull().default(false),
  emailVerificationToken: text('email_verification_token'),
  emailVerificationExpiry: timestamp('email_verification_expiry', {
    withTimezone: true,
    mode: 'date',
  }),
  disabled: boolean('disabled').notNull().default(false),
  // NOTE: Migration required — run `bun run db:generate` then `bun run db:migrate`
  // to add this column to existing databases.
  preferences: jsonb('preferences')
    .$type<UserPreferencesRecord>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
