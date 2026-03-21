import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/**
 * Web Push notification subscriptions.
 *
 * Each row stores a browser push subscription for a user. The `endpoint`,
 * `p256dh`, and `auth` fields come from the PushSubscription object returned
 * by the browser's Push API. The endpoint is unique — re-subscribing from the
 * same browser replaces the previous row.
 */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
