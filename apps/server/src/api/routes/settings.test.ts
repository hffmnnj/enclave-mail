import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';

import type { UserPreferencesRecord } from '@enclave/db';

import type { AuthVariables } from '../../middleware/auth.js';
import {
  type ServerInfo,
  type SettingsRouteDeps,
  type UserPreferences,
  createSettingsRouter,
} from './settings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-settings-42';

/** Wraps the settings router with a fake auth middleware that injects userId. */
function createAppWithAuth(deps: SettingsRouteDeps, userId = TEST_USER_ID) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Simulate auth middleware for /settings (not /settings/server)
  app.use('/settings', async (c, next) => {
    c.set('userId', userId);
    await next();
  });

  const router = createSettingsRouter(deps);
  app.route('/', router);
  return app;
}

/** Wraps the settings router WITHOUT auth middleware (for testing public routes). */
function createAppWithoutAuth(deps: SettingsRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const router = createSettingsRouter(deps);
  app.route('/', router);
  return app;
}

const defaultServerInfo: ServerInfo = {
  domain: 'mail.enclave.test',
  version: '0.1.0',
  dkimEnabled: true,
  tlsEnabled: false,
};

const baseDeps = (): SettingsRouteDeps => ({
  getPreferences: mock(async (_userId: string): Promise<UserPreferencesRecord | null> => ({})),
  updatePreferences: mock(
    async (_userId: string, prefs: UserPreferencesRecord): Promise<UserPreferencesRecord> => prefs,
  ),
  getServerInfo: () => defaultServerInfo,
});

// ---------------------------------------------------------------------------
// GET /settings
// ---------------------------------------------------------------------------

describe('GET /settings', () => {
  test('returns default preferences when user has no stored preferences', async () => {
    const deps = baseDeps();
    (deps.getPreferences as ReturnType<typeof mock>).mockImplementation(async () => null);
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: UserPreferences };
    expect(body.data).toEqual({
      theme: 'dark',
      notificationsEnabled: true,
      autoMarkRead: true,
      messagesPerPage: 50,
    });
  });

  test('returns stored preferences merged with defaults', async () => {
    const deps = baseDeps();
    (deps.getPreferences as ReturnType<typeof mock>).mockImplementation(async () => ({
      displayName: 'Alice',
      theme: 'light' as const,
    }));
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: UserPreferences };
    expect(body.data.displayName).toBe('Alice');
    expect(body.data.theme).toBe('light');
    // Defaults still present for unset fields
    expect(body.data.notificationsEnabled).toBe(true);
    expect(body.data.messagesPerPage).toBe(50);
  });

  test('calls getPreferences with the authenticated userId', async () => {
    const deps = baseDeps();
    const app = createAppWithAuth(deps, 'user-xyz');

    await app.request('/settings', { method: 'GET' });

    expect(deps.getPreferences).toHaveBeenCalledWith('user-xyz');
  });
});

// ---------------------------------------------------------------------------
// PUT /settings
// ---------------------------------------------------------------------------

describe('PUT /settings', () => {
  test('partially updates preferences and returns merged result', async () => {
    const deps = baseDeps();
    (deps.getPreferences as ReturnType<typeof mock>).mockImplementation(async () => ({
      theme: 'light' as const,
      displayName: 'Alice',
    }));
    (deps.updatePreferences as ReturnType<typeof mock>).mockImplementation(
      async (_userId: string, prefs: UserPreferencesRecord) => prefs,
    );
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messagesPerPage: 100 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: UserPreferences };
    // Existing values preserved
    expect(body.data.displayName).toBe('Alice');
    expect(body.data.theme).toBe('light');
    // New value applied
    expect(body.data.messagesPerPage).toBe(100);
  });

  test('returns 400 for invalid preference values', async () => {
    const deps = baseDeps();
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messagesPerPage: 5 }), // min is 10
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 for invalid theme value', async () => {
    const deps = baseDeps();
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'neon' }),
    });

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid JSON body', async () => {
    const deps = baseDeps();
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 when displayName exceeds max length', async () => {
    const deps = baseDeps();
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'x'.repeat(101) }),
    });

    expect(res.status).toBe(400);
  });

  test('returns 400 when signature exceeds max length', async () => {
    const deps = baseDeps();
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signature: 'x'.repeat(5001) }),
    });

    expect(res.status).toBe(400);
  });

  test('accepts empty body as valid partial update', async () => {
    const deps = baseDeps();
    const app = createAppWithAuth(deps);

    const res = await app.request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
  });

  test('calls updatePreferences with merged preferences', async () => {
    const deps = baseDeps();
    (deps.getPreferences as ReturnType<typeof mock>).mockImplementation(async () => ({
      displayName: 'Bob',
    }));
    (deps.updatePreferences as ReturnType<typeof mock>).mockImplementation(
      async (_userId: string, prefs: UserPreferencesRecord) => prefs,
    );
    const app = createAppWithAuth(deps);

    await app.request('/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'system' }),
    });

    expect(deps.updatePreferences).toHaveBeenCalledWith(TEST_USER_ID, {
      displayName: 'Bob',
      theme: 'system',
    });
  });
});

// ---------------------------------------------------------------------------
// GET /settings/server
// ---------------------------------------------------------------------------

describe('GET /settings/server', () => {
  test('returns server info without requiring auth', async () => {
    const deps = baseDeps();
    const app = createAppWithoutAuth(deps);

    const res = await app.request('/settings/server', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: ServerInfo };
    expect(body.data).toEqual(defaultServerInfo);
  });

  test('returns correct domain and feature flags', async () => {
    const deps = baseDeps();
    deps.getServerInfo = () => ({
      domain: 'custom.domain.com',
      version: '0.1.0',
      dkimEnabled: false,
      tlsEnabled: true,
    });
    const app = createAppWithoutAuth(deps);

    const res = await app.request('/settings/server', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: ServerInfo };
    expect(body.data.domain).toBe('custom.domain.com');
    expect(body.data.dkimEnabled).toBe(false);
    expect(body.data.tlsEnabled).toBe(true);
  });

  test('wraps response in ApiResponse format', async () => {
    const deps = baseDeps();
    const app = createAppWithoutAuth(deps);

    const res = await app.request('/settings/server', { method: 'GET' });

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('data');
    expect(typeof body.data).toBe('object');
  });
});
