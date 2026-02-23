import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';

import type { AuthVariables } from '../../middleware/auth.js';
import { createMailboxRouter } from './mailbox.js';

// ---------------------------------------------------------------------------
// Mock auth middleware — injects a fixed userId without real session lookup
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-test-001';

const mockAuthMiddleware = async (
  c: { set: (key: string, value: string) => void },
  next: () => Promise<void>,
) => {
  c.set('userId', TEST_USER_ID);
  await next();
};

// ---------------------------------------------------------------------------
// Mock DB helpers
// ---------------------------------------------------------------------------

type MockDb = {
  selectResult: unknown[];
  insertResult: unknown[];
  deleteResult: unknown[];
  countResult: { value: number }[];
  lastQuery: string;
  selectFn: ReturnType<typeof mock>;
  insertFn: ReturnType<typeof mock>;
  deleteFn: ReturnType<typeof mock>;
};

const createMockDb = (): MockDb => {
  const state: MockDb = {
    selectResult: [],
    insertResult: [],
    deleteResult: [],
    countResult: [{ value: 0 }],
    lastQuery: '',
    selectFn: mock(() => state),
    insertFn: mock(() => state),
    deleteFn: mock(() => state),
  };
  return state;
};

// ---------------------------------------------------------------------------
// Helper to build a test app with mocked dependencies
// ---------------------------------------------------------------------------

const buildTestApp = () => {
  const mockDb = createMockDb();

  // Build a chainable mock that simulates Drizzle's query builder
  const chainable = (result: () => unknown[]) => {
    const chain: Record<string, unknown> = {};
    const methods = [
      'select',
      'from',
      'where',
      'insert',
      'values',
      'returning',
      'delete',
      'update',
      'set',
      'innerJoin',
      'orderBy',
      'offset',
      'limit',
    ];
    for (const method of methods) {
      chain[method] = mock((..._args: unknown[]) => {
        // 'returning' and 'from' and 'where' and 'limit' are terminal-ish
        return new Proxy(chain, {
          get(target, prop) {
            if (prop === 'then') {
              // Make it thenable — resolve with result
              return (resolve: (v: unknown) => void) => resolve(result());
            }
            return target[prop as string];
          },
        });
      });
    }
    return chain;
  };

  // Track call sequences to return different results
  let selectCallCount = 0;
  const selectResults: unknown[][] = [];

  const fakeDb = {
    select: mock((..._args: unknown[]) => {
      const idx = selectCallCount++;
      const result = selectResults[idx] ?? [];
      return chainable(() => result);
    }),
    insert: mock((..._args: unknown[]) => {
      return chainable(() => mockDb.insertResult);
    }),
    delete: mock((..._args: unknown[]) => {
      return chainable(() => mockDb.deleteResult);
    }),
    update: mock((..._args: unknown[]) => {
      return chainable(() => []);
    }),
  };

  const router = createMailboxRouter({
    getDb: () => fakeDb as unknown as typeof import('@enclave/db').db,
    middleware: [],
  });

  // Create app with mock auth (applied before router, not inside it)
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', mockAuthMiddleware);
  app.route('/', router);

  return {
    app,
    mockDb,
    fakeDb,
    selectResults,
    resetSelectCount: () => {
      selectCallCount = 0;
    },
  };
};

// ---------------------------------------------------------------------------
// GET /mailboxes
// ---------------------------------------------------------------------------

describe('GET /mailboxes', () => {
  test('returns list of mailboxes for authenticated user', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [
      {
        id: 'mbox-1',
        name: 'INBOX',
        type: 'inbox',
        messageCount: 10,
        unreadCount: 3,
        uidNext: 11,
      },
      {
        id: 'mbox-2',
        name: 'Sent',
        type: 'sent',
        messageCount: 5,
        unreadCount: 0,
        uidNext: 6,
      },
    ];

    const res = await app.request('/mailboxes');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toEqual({
      id: 'mbox-1',
      name: 'INBOX',
      type: 'inbox',
      messageCount: 10,
      unreadCount: 3,
      uidNext: 11,
    });
  });

  test('returns empty array when user has no mailboxes', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();
    selectResults[0] = [];

    const res = await app.request('/mailboxes');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /mailboxes
// ---------------------------------------------------------------------------

describe('POST /mailboxes', () => {
  test('creates a custom mailbox and returns 201', async () => {
    const { app, selectResults, resetSelectCount, mockDb } = buildTestApp();
    resetSelectCount();

    // First select: duplicate check — no existing mailbox
    selectResults[0] = [];
    // Insert returning
    mockDb.insertResult = [{ id: 'mbox-new', name: 'Work' }];

    const res = await app.request('/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Work' }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string; name: string } };
    expect(json.data.id).toBe('mbox-new');
    expect(json.data.name).toBe('Work');
  });

  test('returns 400 for missing name', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 for empty name', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid JSON body', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  test('returns 409 for duplicate mailbox name', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    // Duplicate check returns existing mailbox
    selectResults[0] = [{ id: 'mbox-existing' }];

    const res = await app.request('/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'INBOX' }),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('DUPLICATE_MAILBOX');
  });
});

// ---------------------------------------------------------------------------
// DELETE /mailboxes/:id
// ---------------------------------------------------------------------------

describe('DELETE /mailboxes/:id', () => {
  test('deletes a custom mailbox and returns 204', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'mbox-custom', type: 'custom' }];

    const res = await app.request('/mailboxes/mbox-custom', { method: 'DELETE' });

    expect(res.status).toBe(204);
  });

  test('returns 404 for non-existent mailbox', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [];

    const res = await app.request('/mailboxes/mbox-nonexistent', { method: 'DELETE' });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('NOT_FOUND');
  });

  test('returns 403 for system mailbox (inbox)', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'mbox-inbox', type: 'inbox' }];

    const res = await app.request('/mailboxes/mbox-inbox', { method: 'DELETE' });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('FORBIDDEN');
  });

  test('returns 403 for system mailbox (trash)', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'mbox-trash', type: 'trash' }];

    const res = await app.request('/mailboxes/mbox-trash', { method: 'DELETE' });

    expect(res.status).toBe(403);
  });

  test('returns 403 for system mailbox (sent)', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'mbox-sent', type: 'sent' }];

    const res = await app.request('/mailboxes/mbox-sent', { method: 'DELETE' });

    expect(res.status).toBe(403);
  });

  test('returns 403 for system mailbox (drafts)', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'mbox-drafts', type: 'drafts' }];

    const res = await app.request('/mailboxes/mbox-drafts', { method: 'DELETE' });

    expect(res.status).toBe(403);
  });

  test('returns 403 for system mailbox (archive)', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'mbox-archive', type: 'archive' }];

    const res = await app.request('/mailboxes/mbox-archive', { method: 'DELETE' });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /mailboxes/:id/stats
// ---------------------------------------------------------------------------

describe('GET /mailboxes/:id/stats', () => {
  test('returns stats for a valid mailbox', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    // First select: mailbox ownership check
    selectResults[0] = [{ id: 'mbox-1' }];
    // Second select: total count
    selectResults[1] = [{ value: 42 }];
    // Third select: unread count
    selectResults[2] = [{ value: 5 }];
    // Fourth select: recent count
    selectResults[3] = [{ value: 2 }];

    const res = await app.request('/mailboxes/mbox-1/stats');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { total: number; unread: number; recent: number } };
    expect(json.data.total).toBe(42);
    expect(json.data.unread).toBe(5);
    expect(json.data.recent).toBe(2);
  });

  test('returns 404 for non-existent mailbox', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [];

    const res = await app.request('/mailboxes/mbox-nonexistent/stats');

    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('NOT_FOUND');
  });
});
