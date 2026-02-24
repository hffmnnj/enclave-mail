import { db, users } from '@enclave/db';
import type { UserPreferencesRecord } from '@enclave/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AuthVariables } from '../../middleware/auth.js';
import type { ApiResponse } from '../types.js';

// ---------------------------------------------------------------------------
// Zod schema for user preferences
// ---------------------------------------------------------------------------

export const PreferencesSchema = z.object({
  displayName: z.string().max(100).optional(),
  signature: z.string().max(5000).optional(),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  notificationsEnabled: z.boolean().default(true),
  autoMarkRead: z.boolean().default(true),
  messagesPerPage: z.number().int().min(10).max(200).default(50),
});

export type UserPreferences = z.infer<typeof PreferencesSchema>;

/**
 * Schema for partial preference updates. Uses the same validation rules
 * but without `.default()` so that omitted fields stay absent rather than
 * being filled with defaults (which would overwrite existing stored values).
 */
export const PreferencesUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  signature: z.string().max(5000).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  notificationsEnabled: z.boolean().optional(),
  autoMarkRead: z.boolean().optional(),
  messagesPerPage: z.number().int().min(10).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Server info response type
// ---------------------------------------------------------------------------

export interface ServerInfo {
  domain: string;
  version: string;
  dkimEnabled: boolean;
  tlsEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Default preferences (applied when user has no stored preferences)
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  notificationsEnabled: true,
  autoMarkRead: true,
  messagesPerPage: 50,
};

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

export interface SettingsRouteDeps {
  getPreferences: (userId: string) => Promise<UserPreferencesRecord | null>;
  updatePreferences: (
    userId: string,
    prefs: UserPreferencesRecord,
  ) => Promise<UserPreferencesRecord>;
  getServerInfo: () => ServerInfo;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

const parseBody = async <TSchema extends z.ZodTypeAny>(
  c: Context,
  schema: TSchema,
): Promise<{ success: true; data: z.infer<TSchema> } | { success: false; error: z.ZodError }> => {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    const zodError = new z.ZodError([{ code: 'custom', message: 'Invalid JSON body', path: [] }]);
    return { success: false, error: zodError };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { success: false, error: parsed.error };
  }

  return { success: true, data: parsed.data };
};

/**
 * Merge stored preferences with defaults so the response always contains
 * every field, even when the user has never explicitly set a value.
 */
const mergeWithDefaults = (stored: UserPreferencesRecord): UserPreferences => {
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
  };
};

export const createSettingsRouter = (
  deps: SettingsRouteDeps,
): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();

  // GET /settings — return current user preferences (auth required)
  router.get('/settings', async (c) => {
    const userId = c.get('userId');

    const stored = await deps.getPreferences(userId);
    const preferences = mergeWithDefaults(stored ?? {});

    const response: ApiResponse<UserPreferences> = { data: preferences };
    return c.json(response, 200);
  });

  // PUT /settings — partial update of user preferences (auth required)
  router.put('/settings', async (c) => {
    const userId = c.get('userId');

    const result = parseBody(c, PreferencesUpdateSchema);
    const parsed = await result;

    if (!parsed.success) {
      return c.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.issues },
        400,
      );
    }

    // Strip keys whose value is `undefined` so we don't violate
    // exactOptionalPropertyTypes when merging into UserPreferencesRecord.
    const incoming: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        incoming[key] = value;
      }
    }

    // Fetch existing preferences to merge
    const existing = await deps.getPreferences(userId);
    const merged: UserPreferencesRecord = {
      ...(existing ?? {}),
      ...incoming,
    };

    const updated = await deps.updatePreferences(userId, merged);
    const preferences = mergeWithDefaults(updated);

    const response: ApiResponse<UserPreferences> = { data: preferences };
    return c.json(response, 200);
  });

  // GET /settings/server — public server info (no auth required)
  router.get('/settings/server', (c) => {
    const info = deps.getServerInfo();
    const response: ApiResponse<ServerInfo> = { data: info };
    return c.json(response, 200);
  });

  return router;
};

// ---------------------------------------------------------------------------
// Default implementations wired to real dependencies
// ---------------------------------------------------------------------------

const defaultGetPreferences = async (userId: string): Promise<UserPreferencesRecord | null> => {
  const rows = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId));

  const row = rows[0];
  if (!row) {
    return null;
  }

  return row.preferences;
};

const defaultUpdatePreferences = async (
  userId: string,
  prefs: UserPreferencesRecord,
): Promise<UserPreferencesRecord> => {
  const rows = await db
    .update(users)
    .set({ preferences: prefs, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ preferences: users.preferences });

  const row = rows[0];
  if (!row) {
    throw new Error(`User ${userId} not found`);
  }

  return row.preferences;
};

const defaultGetServerInfo = (): ServerInfo => ({
  domain: process.env.SMTP_DOMAIN ?? 'localhost',
  version: '0.1.0',
  dkimEnabled: Boolean(process.env.DKIM_PRIVATE_KEY_PATH),
  tlsEnabled: Boolean(process.env.TLS_CERT_PATH),
});

export const settingsRouter = createSettingsRouter({
  getPreferences: defaultGetPreferences,
  updatePreferences: defaultUpdatePreferences,
  getServerInfo: defaultGetServerInfo,
});
