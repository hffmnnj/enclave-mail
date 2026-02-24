import { describe, expect, mock, test } from 'bun:test';
import { createMiddleware } from 'hono/factory';

import type { DbClient } from '@enclave/db';

import type { DnsCheckResult } from '../services/dns-check-service.js';

mock.module('../middleware/auth.js', () => {
  const authMiddleware = createMiddleware(async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    const token = authHeader.slice(7);
    const userId = token === 'admin-token' ? 'admin-user' : 'member-user';
    c.set('userId', userId);
    await next();
  });

  const requireAdmin = createMiddleware(async (c, next) => {
    const userId = c.get('userId');

    if (userId !== 'admin-user') {
      return c.json(
        {
          error: 'ADMIN_REQUIRED',
          message: 'This action requires administrator privileges',
        },
        403,
      );
    }

    await next();
  });

  return {
    authMiddleware,
    requireAdmin,
  };
});

const { createSetupRouter } = await import('./setup.js');

interface TestState {
  userRows: Array<{ id: string; isAdmin: boolean }>;
  config: Map<'domain' | 'registration_enabled', unknown>;
  dnsCheckResult: DnsCheckResult;
}

const defaultDnsCheckResult: DnsCheckResult = {
  mx: 'pass',
  spf: 'pass',
  dkim: 'pass',
  dmarc: 'pass',
  allPassed: true,
};

const createDbClientMock = (state: TestState): DbClient => {
  const dbClient = {
    select: (selection: unknown) => ({
      from: (_table: unknown) => ({
        limit: async (count: number): Promise<Array<{ id: string; isAdmin?: boolean }>> => {
          const wantsAdmin =
            selection !== null && typeof selection === 'object' && 'isAdmin' in selection;

          return state.userRows
            .slice(0, count)
            .map((row) => (wantsAdmin ? { id: row.id, isAdmin: row.isAdmin } : { id: row.id }));
        },
      }),
    }),
  };

  return dbClient as unknown as DbClient;
};

const createRouter = (state: TestState) =>
  createSetupRouter({
    dbClient: createDbClientMock(state),
    configSvc: {
      getConfig: async (key) => state.config.get(key) ?? null,
      setConfig: async (key, value) => {
        state.config.set(key, value);
      },
    },
    dnsCheckSvc: {
      checkDns: async (_domain: string) => state.dnsCheckResult,
    },
    tlsSvc: {
      triggerCertbot: async (_domain: string) => ({ success: true, message: 'ok' }),
      getCertificateStatus: async (domain: string) => ({
        hasCertificate: true,
        domain,
        certPath: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
      }),
    },
  });

const createState = (overrides?: Partial<TestState>): TestState => ({
  userRows: [],
  config: new Map<'domain' | 'registration_enabled', unknown>(),
  dnsCheckResult: defaultDnsCheckResult,
  ...overrides,
});

describe('GET /setup/status', () => {
  test('returns hasUsers false on empty database', async () => {
    const router = createRouter(createState());
    const response = await router.request('/setup/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasUsers: false, isSetupComplete: false });
  });

  test('returns hasUsers true when users exist', async () => {
    const router = createRouter(
      createState({
        userRows: [{ id: 'admin-user', isAdmin: true }],
      }),
    );

    const response = await router.request('/setup/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasUsers: true, isSetupComplete: false });
  });
});

describe('GET /setup/registration', () => {
  test('returns enabled true by default when unset', async () => {
    const router = createRouter(createState());
    const response = await router.request('/setup/registration');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
  });

  test('returns stored registration setting when configured', async () => {
    const state = createState();
    state.config.set('registration_enabled', false);
    const router = createRouter(state);

    const response = await router.request('/setup/registration');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
  });
});

describe('PUT /setup/registration', () => {
  test('returns 403 for non-admin user', async () => {
    const state = createState({
      userRows: [
        { id: 'admin-user', isAdmin: true },
        { id: 'member-user', isAdmin: false },
      ],
    });
    const router = createRouter(state);

    const response = await router.request('/setup/registration', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer member-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'ADMIN_REQUIRED',
      message: 'This action requires administrator privileges',
    });
  });

  test('updates registration setting for admin user', async () => {
    const state = createState({
      userRows: [{ id: 'admin-user', isAdmin: true }],
    });
    const router = createRouter(state);

    const response = await router.request('/setup/registration', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, enabled: false });
    expect(state.config.get('registration_enabled')).toBe(false);
  });
});

describe('POST /setup/dns-check', () => {
  test('returns DNS check result from the DNS service', async () => {
    const dnsCheckResult: DnsCheckResult = {
      mx: 'pass',
      spf: 'not-found',
      dkim: 'fail',
      dmarc: 'pass',
      allPassed: false,
    };

    const state = createState({ dnsCheckResult });
    state.config.set('domain', 'example.com');
    const router = createRouter(state);

    const response = await router.request('/setup/dns-check', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(dnsCheckResult);
  });
});
