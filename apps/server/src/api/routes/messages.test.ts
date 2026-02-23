import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';

import type { AuthVariables } from '../../middleware/auth.js';
import { createMessageRouter } from './messages.js';

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
// Chainable mock DB builder
// ---------------------------------------------------------------------------

const buildTestApp = () => {
  let selectCallCount = 0;
  const selectResults: unknown[][] = [];
  let insertResult: unknown[] = [];
  let updateCalled = false;

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
        return new Proxy(chain, {
          get(target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => void) => resolve(result());
            }
            return target[prop as string];
          },
        });
      });
    }
    return chain;
  };

  const fakeDb = {
    select: mock((..._args: unknown[]) => {
      const idx = selectCallCount++;
      const result = selectResults[idx] ?? [];
      return chainable(() => result);
    }),
    insert: mock((..._args: unknown[]) => {
      return chainable(() => insertResult);
    }),
    delete: mock((..._args: unknown[]) => {
      return chainable(() => []);
    }),
    update: mock((..._args: unknown[]) => {
      updateCalled = true;
      return chainable(() => []);
    }),
  };

  const router = createMessageRouter({
    getDb: () => fakeDb as unknown as typeof import('@enclave/db').db,
    middleware: [],
  });

  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', mockAuthMiddleware);
  app.route('/', router);

  return {
    app,
    fakeDb,
    selectResults,
    setInsertResult: (r: unknown[]) => {
      insertResult = r;
    },
    wasUpdateCalled: () => updateCalled,
    resetSelectCount: () => {
      selectCallCount = 0;
    },
  };
};

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleMessageRow = {
  id: 'msg-001',
  uid: 1,
  messageId: '<abc@example.com>',
  fromAddress: 'alice@example.com',
  toAddresses: ['bob@example.com'],
  subjectEncrypted: new Uint8Array([72, 101, 108, 108, 111]),
  date: new Date('2026-01-15T10:00:00Z'),
  flags: ['seen'],
  size: 1024,
  dkimStatus: 'pass',
  spfStatus: 'pass',
  dmarcStatus: 'pass',
};

const sampleMessageRowNoSubject = {
  ...sampleMessageRow,
  id: 'msg-002',
  subjectEncrypted: null,
};

// ---------------------------------------------------------------------------
// GET /mailboxes/:id/messages
// ---------------------------------------------------------------------------

describe('GET /mailboxes/:id/messages', () => {
  test('returns paginated message list', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    // First select: mailbox ownership check
    selectResults[0] = [{ id: 'mbox-1' }];
    // Second select: total count
    selectResults[1] = [{ value: 1 }];
    // Third select: message rows
    selectResults[2] = [sampleMessageRow];

    const res = await app.request('/mailboxes/mbox-1/messages');

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: unknown[];
      total: number;
      offset: number;
      limit: number;
    };
    expect(json.total).toBe(1);
    expect(json.offset).toBe(0);
    expect(json.limit).toBe(50);
    expect(json.data).toHaveLength(1);

    const msg = json.data[0] as Record<string, unknown>;
    expect(msg.id).toBe('msg-001');
    expect(msg.fromAddress).toBe('alice@example.com');
    // subjectEncrypted should be base64 encoded
    expect(typeof msg.subjectEncrypted).toBe('string');
    // date should be ISO string
    expect(msg.date).toBe('2026-01-15T10:00:00.000Z');
    // flags should be structured object
    const flags = msg.flags as Record<string, boolean>;
    expect(flags.seen).toBe(true);
    expect(flags.flagged).toBe(false);
    expect(flags.deleted).toBe(false);
    expect(flags.draft).toBe(false);
  });

  test('returns null for subjectEncrypted when not present', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'mbox-1' }];
    selectResults[1] = [{ value: 1 }];
    selectResults[2] = [sampleMessageRowNoSubject];

    const res = await app.request('/mailboxes/mbox-1/messages');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ subjectEncrypted: string | null }> };
    expect(json.data[0]?.subjectEncrypted).toBeNull();
  });

  test('respects custom pagination params', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'mbox-1' }];
    selectResults[1] = [{ value: 100 }];
    selectResults[2] = [];

    const res = await app.request('/mailboxes/mbox-1/messages?offset=10&limit=25');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { offset: number; limit: number };
    expect(json.offset).toBe(10);
    expect(json.limit).toBe(25);
  });

  test('returns 400 for invalid pagination (limit > 200)', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/mailboxes/mbox-1/messages?limit=500');

    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 for negative offset', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/mailboxes/mbox-1/messages?offset=-1');

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent mailbox', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [];

    const res = await app.request('/mailboxes/mbox-nonexistent/messages');

    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /messages/:id
// ---------------------------------------------------------------------------

describe('GET /messages/:id', () => {
  test('returns full message with encrypted body', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    // First select: message with mailbox join
    selectResults[0] = [{ ...sampleMessageRow, mailboxUserId: TEST_USER_ID }];
    // Second select: message body
    selectResults[1] = [
      {
        encryptedBody: new Uint8Array([1, 2, 3, 4]),
        contentType: 'text/html',
        encryptionMetadata: { algorithm: 'xchacha20-poly1305' },
      },
    ];

    const res = await app.request('/messages/msg-001');

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        id: string;
        body: { encryptedBody: string; contentType: string; encryptionMetadata: unknown } | null;
      };
    };
    expect(json.data.id).toBe('msg-001');
    expect(json.data.body).not.toBeNull();
    expect(json.data.body?.contentType).toBe('text/html');
    // encryptedBody should be base64
    expect(typeof json.data.body?.encryptedBody).toBe('string');
    expect(json.data.body?.encryptionMetadata).toEqual({ algorithm: 'xchacha20-poly1305' });
  });

  test('returns null body when message has no body record', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ ...sampleMessageRow, mailboxUserId: TEST_USER_ID }];
    selectResults[1] = [];

    const res = await app.request('/messages/msg-001');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { body: unknown } };
    expect(json.data.body).toBeNull();
  });

  test('returns 404 for non-existent message', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [];

    const res = await app.request('/messages/msg-nonexistent');

    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('NOT_FOUND');
  });

  test('returns 404 when message belongs to different user', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ ...sampleMessageRow, mailboxUserId: 'other-user-id' }];

    const res = await app.request('/messages/msg-001');

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /messages/:id/flags
// ---------------------------------------------------------------------------

describe('PATCH /messages/:id/flags', () => {
  test('updates flags and returns new flag state', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    // First select: message with current flags
    selectResults[0] = [{ id: 'msg-001', flags: ['seen'], mailboxUserId: TEST_USER_ID }];
    // Second select for mailbox update (mailboxId lookup)
    selectResults[1] = [{ mailboxId: 'mbox-1' }];

    const res = await app.request('/messages/msg-001/flags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flags: { flagged: true } }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { flags: Record<string, boolean> } };
    expect(json.data.flags.seen).toBe(true);
    expect(json.data.flags.flagged).toBe(true);
  });

  test('can remove a flag', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'msg-001', flags: ['seen', 'flagged'], mailboxUserId: TEST_USER_ID }];
    // No mailbox update needed when seen status doesn't change
    selectResults[1] = [{ mailboxId: 'mbox-1' }];

    const res = await app.request('/messages/msg-001/flags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flags: { flagged: false } }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { flags: Record<string, boolean> } };
    expect(json.data.flags.flagged).toBe(false);
    expect(json.data.flags.seen).toBe(true);
  });

  test('returns 400 for invalid JSON', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/messages/msg-001/flags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid flag values', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/messages/msg-001/flags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flags: { seen: 'yes' } }),
    });

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent message', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [];

    const res = await app.request('/messages/msg-nonexistent/flags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flags: { seen: true } }),
    });

    expect(res.status).toBe(404);
  });

  test('returns 404 when message belongs to different user', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'msg-001', flags: [], mailboxUserId: 'other-user' }];

    const res = await app.request('/messages/msg-001/flags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flags: { seen: true } }),
    });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /messages/:id
// ---------------------------------------------------------------------------

describe('DELETE /messages/:id', () => {
  test('permanently deletes message already in trash', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [
      {
        id: 'msg-001',
        mailboxId: 'mbox-trash',
        mailboxUserId: TEST_USER_ID,
        mailboxType: 'trash',
      },
    ];

    const res = await app.request('/messages/msg-001', { method: 'DELETE' });

    expect(res.status).toBe(204);
  });

  test('moves message to trash when not already in trash', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    // First select: message with mailbox info
    selectResults[0] = [
      {
        id: 'msg-001',
        mailboxId: 'mbox-inbox',
        mailboxUserId: TEST_USER_ID,
        mailboxType: 'inbox',
      },
    ];
    // Second select: find trash mailbox
    selectResults[1] = [{ id: 'mbox-trash', uidNext: 5 }];

    const res = await app.request('/messages/msg-001', { method: 'DELETE' });

    expect(res.status).toBe(204);
  });

  test('returns 404 for non-existent message', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [];

    const res = await app.request('/messages/msg-nonexistent', { method: 'DELETE' });

    expect(res.status).toBe(404);
  });

  test('returns 404 when message belongs to different user', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [
      {
        id: 'msg-001',
        mailboxId: 'mbox-inbox',
        mailboxUserId: 'other-user',
        mailboxType: 'inbox',
      },
    ];

    const res = await app.request('/messages/msg-001', { method: 'DELETE' });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /messages/:id/move
// ---------------------------------------------------------------------------

describe('POST /messages/:id/move', () => {
  const ARCHIVE_UUID = 'a0000000-0000-4000-a000-000000000002';
  const INBOX_UUID = 'b0000000-0000-4000-a000-000000000003';

  test('moves message to target mailbox', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    // First select: message ownership
    selectResults[0] = [{ id: 'msg-001', mailboxId: INBOX_UUID, mailboxUserId: TEST_USER_ID }];
    // Second select: target mailbox
    selectResults[1] = [{ id: ARCHIVE_UUID, uidNext: 10 }];

    const res = await app.request('/messages/msg-001/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetMailboxId: ARCHIVE_UUID }),
    });

    expect(res.status).toBe(204);
  });

  test('returns 204 for no-op move (same mailbox)', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'msg-001', mailboxId: INBOX_UUID, mailboxUserId: TEST_USER_ID }];
    selectResults[1] = [{ id: INBOX_UUID, uidNext: 10 }];

    const res = await app.request('/messages/msg-001/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetMailboxId: INBOX_UUID }),
    });

    expect(res.status).toBe(204);
  });

  test('returns 400 for invalid JSON', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/messages/msg-001/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });

  test('returns 400 for missing targetMailboxId', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/messages/msg-001/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test('returns 400 for non-UUID targetMailboxId', async () => {
    const { app } = buildTestApp();

    const res = await app.request('/messages/msg-001/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetMailboxId: 'not-a-uuid' }),
    });

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent message', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [];

    const res = await app.request('/messages/msg-001/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetMailboxId: 'c0000000-0000-4000-a000-000000000001' }),
    });

    expect(res.status).toBe(404);
  });

  test('returns 404 for non-existent target mailbox', async () => {
    const { app, selectResults, resetSelectCount } = buildTestApp();
    resetSelectCount();

    selectResults[0] = [{ id: 'msg-001', mailboxId: 'mbox-inbox', mailboxUserId: TEST_USER_ID }];
    selectResults[1] = [];

    const res = await app.request('/messages/msg-001/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetMailboxId: 'c0000000-0000-4000-a000-000000000001' }),
    });

    expect(res.status).toBe(404);
  });
});
