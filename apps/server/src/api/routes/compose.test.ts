import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ComposeRouteDeps } from './compose.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = 'user-001';
const USER_EMAIL = 'alice@enclave.test';
const SENT_MAILBOX_ID = 'sent-box-001';
const DRAFTS_MAILBOX_ID = 'drafts-box-001';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let insertResult: Array<{ id: string }> = [{ id: 'msg-001' }];
let queuedJobs: Array<{ name: string; data: unknown }> = [];

// ---------------------------------------------------------------------------
// Mock @enclave/db
// ---------------------------------------------------------------------------

const selectWhereMock = mock(async (): Promise<unknown[]> => selectResult);

const selectOrderByMock = mock(async (): Promise<unknown[]> => selectResult);

const insertReturningMock = mock(async (): Promise<Array<{ id: string }>> => insertResult);

const updateWhereMock = mock(async (): Promise<void> => {});

const deleteWhereMock = mock(async (): Promise<void> => {});

const transactionMock = mock(async (fn: (tx: unknown) => Promise<void>): Promise<void> => {
  const tx = {
    insert: () => ({
      values: () => ({
        returning: insertReturningMock,
      }),
    }),
    update: () => ({
      set: () => ({ where: updateWhereMock }),
    }),
  };
  await fn(tx);
});

mock.module('@enclave/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (..._args: unknown[]) => {
          // Return a promise-like object that also supports .orderBy() chaining.
          // Drizzle queries are thenable and support further chaining.
          const promise = selectWhereMock();
          const chainable = Object.assign(promise, { orderBy: selectOrderByMock });
          return chainable;
        },
        orderBy: selectOrderByMock,
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: insertReturningMock,
      }),
    }),
    update: () => ({
      set: () => ({ where: updateWhereMock }),
    }),
    delete: () => ({
      where: deleteWhereMock,
    }),
    transaction: transactionMock,
  },
  mailboxes: {
    id: 'id',
    userId: 'user_id',
    type: 'type',
    uidNext: 'uid_next',
    messageCount: 'message_count',
    updatedAt: 'updated_at',
  },
  messages: {
    id: 'id',
    mailboxId: 'mailbox_id',
    toAddresses: 'to_addresses',
    subjectEncrypted: 'subject_encrypted',
    updatedAt: 'updated_at',
    date: 'date',
  },
  messageBodies: {
    messageId: 'message_id',
    encryptedBody: 'encrypted_body',
    encryptionMetadata: 'encryption_metadata',
  },
  users: { id: 'id', email: 'email' },
}));

mock.module('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

// ---------------------------------------------------------------------------
// Mock auth middleware — bypass for route testing
// ---------------------------------------------------------------------------

mock.module('../../middleware/auth.js', () => {
  const passthrough = async (
    c: { set: (key: string, value: string) => void },
    next: () => Promise<void>,
  ) => {
    c.set('userId', USER_ID);
    await next();
  };

  return {
    authMiddleware: passthrough,
    requireKeyExport: async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  };
});

// ---------------------------------------------------------------------------
// Mock queue
// ---------------------------------------------------------------------------

mock.module('../../queue/mail-queue.js', () => ({
  createOutboundMailQueue: () => ({
    add: async (name: string, data: unknown) => {
      queuedJobs.push({ name, data });
    },
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { createComposeRouter } = await import('./compose.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DbType = ReturnType<ComposeRouteDeps['getDb']>;
type QueueType = ReturnType<ComposeRouteDeps['getOutboundQueue']>;

function createRouter(overrides?: Partial<ComposeRouteDeps>) {
  return createComposeRouter({
    getDb: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@enclave/db') as { db: unknown };
      return mod.db as DbType;
    },
    getOutboundQueue: () =>
      ({
        add: async (name: string, data: unknown) => {
          queuedJobs.push({ name, data });
          return {} as unknown;
        },
      }) as unknown as QueueType,
    getUserEmail: async (userId: string) => {
      if (userId === USER_ID) return USER_EMAIL;
      return null;
    },
    ...overrides,
  });
}

async function makeRequest(
  router: ReturnType<typeof createComposeRouter>,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const result = router.request(path, {
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      ...(options.headers as Record<string, string> | undefined),
    },
    ...options,
  });
  return result instanceof Promise ? result : Promise.resolve(result);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('composeRouter', () => {
  beforeEach(() => {
    selectResult = [];
    insertResult = [{ id: 'msg-001' }];
    queuedJobs = [];

    selectWhereMock.mockClear();
    selectOrderByMock.mockClear();
    insertReturningMock.mockClear();
    updateWhereMock.mockClear();
    deleteWhereMock.mockClear();
    transactionMock.mockClear();
  });

  // -----------------------------------------------------------------------
  // POST /compose/send
  // -----------------------------------------------------------------------

  describe('POST /compose/send', () => {
    const validSendPayload = {
      to: ['bob@example.com'],
      cc: ['carol@example.com'],
      encryptedSubject: btoa('encrypted-subject'),
      encryptedBody: btoa('encrypted-body'),
      mimeBody: 'From: alice@enclave.test\r\nTo: bob@example.com\r\n\r\nHello',
      encryptionMetadata: {
        algorithm: 'xchacha20-poly1305',
        recipientKeyFingerprints: ['abc123'],
        version: 1,
      },
    };

    test('stores message in Sent mailbox and queues outbound job', async () => {
      selectWhereMock.mockImplementation(async () => [{ id: SENT_MAILBOX_ID, uidNext: 1 }]);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/send', {
        method: 'POST',
        body: JSON.stringify(validSendPayload),
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: { messageId: string; status: string } };
      expect(json.data.status).toBe('queued');
      expect(json.data.messageId).toBe('msg-001');

      expect(queuedJobs).toHaveLength(1);
      const job = queuedJobs[0]!;
      expect(job.name).toBe('outbound-send');

      const jobData = job.data as Record<string, unknown>;
      expect(jobData.from).toBe(USER_EMAIL);
      expect(jobData.to).toEqual(['bob@example.com', 'carol@example.com']);
      expect(jobData.dkimSign).toBe(true);
      expect(typeof jobData.encryptedMimeBody).toBe('string');
      expect(typeof jobData.mimeBodyNonce).toBe('string');
      expect(jobData.mimeBody).toBeUndefined();
    });

    test('rejects request with missing required fields', async () => {
      const router = createRouter();
      const response = await makeRequest(router, '/compose/send', {
        method: 'POST',
        body: JSON.stringify({ to: [] }),
      });

      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: string; code: string };
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    test('rejects request with invalid email addresses', async () => {
      const router = createRouter();
      const response = await makeRequest(router, '/compose/send', {
        method: 'POST',
        body: JSON.stringify({
          ...validSendPayload,
          to: ['not-an-email'],
        }),
      });

      expect(response.status).toBe(400);
    });

    test('rejects request with empty to array', async () => {
      const router = createRouter();
      const response = await makeRequest(router, '/compose/send', {
        method: 'POST',
        body: JSON.stringify({
          ...validSendPayload,
          to: [],
        }),
      });

      expect(response.status).toBe(400);
    });

    test('rejects request with invalid JSON body', async () => {
      const router = createRouter();
      const result = router.request('/compose/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
        },
        body: 'not-json',
      });

      const response = result instanceof Promise ? await result : result;
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: string; code: string };
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    test('includes bcc recipients in outbound job', async () => {
      selectWhereMock.mockImplementation(async () => [{ id: SENT_MAILBOX_ID, uidNext: 1 }]);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/send', {
        method: 'POST',
        body: JSON.stringify({
          ...validSendPayload,
          bcc: ['secret@example.com'],
        }),
      });

      expect(response.status).toBe(200);
      expect(queuedJobs).toHaveLength(1);
      const jobData = queuedJobs[0]!.data as Record<string, unknown>;
      const recipients = jobData.to as string[];
      expect(recipients).toContain('secret@example.com');
      expect(recipients).toContain('bob@example.com');
      expect(recipients).toContain('carol@example.com');
    });

    test('returns 404 when user email cannot be resolved', async () => {
      const router = createRouter({
        getUserEmail: async () => null,
      });

      const response = await makeRequest(router, '/compose/send', {
        method: 'POST',
        body: JSON.stringify(validSendPayload),
      });

      expect(response.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST /compose/draft
  // -----------------------------------------------------------------------

  describe('POST /compose/draft', () => {
    test('creates a draft with minimal fields', async () => {
      selectWhereMock.mockImplementation(async () => [{ id: DRAFTS_MAILBOX_ID, uidNext: 1 }]);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(201);
      const json = (await response.json()) as { data: { id: string } };
      expect(json.data.id).toBe('msg-001');
    });

    test('creates a draft with all fields', async () => {
      selectWhereMock.mockImplementation(async () => [{ id: DRAFTS_MAILBOX_ID, uidNext: 1 }]);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft', {
        method: 'POST',
        body: JSON.stringify({
          to: ['bob@example.com'],
          cc: ['carol@example.com'],
          subject: 'Draft subject',
          encryptedBody: btoa('draft-body'),
          encryptionMetadata: {
            algorithm: 'xchacha20-poly1305',
          },
        }),
      });

      expect(response.status).toBe(201);
      const json = (await response.json()) as { data: { id: string } };
      expect(json.data.id).toBe('msg-001');
    });

    test('rejects draft with invalid email in to field', async () => {
      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft', {
        method: 'POST',
        body: JSON.stringify({
          to: ['not-an-email'],
        }),
      });

      expect(response.status).toBe(400);
    });

    test('returns 404 when user email cannot be resolved', async () => {
      const router = createRouter({
        getUserEmail: async () => null,
      });

      const response = await makeRequest(router, '/compose/draft', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // GET /compose/drafts
  // -----------------------------------------------------------------------

  describe('GET /compose/drafts', () => {
    test('returns empty list when no drafts exist', async () => {
      selectWhereMock.mockImplementationOnce(async () => [{ id: DRAFTS_MAILBOX_ID }]);
      selectOrderByMock.mockImplementationOnce(async () => []);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/drafts', { method: 'GET' });

      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: unknown[] };
      expect(json.data).toEqual([]);
    });

    test('returns list of drafts with subject decoded', async () => {
      const now = new Date('2026-02-23T12:00:00Z');

      selectWhereMock.mockImplementationOnce(async () => [{ id: DRAFTS_MAILBOX_ID }]);
      selectOrderByMock.mockImplementationOnce(async () => [
        {
          id: 'draft-001',
          toAddresses: ['bob@example.com'],
          subjectEncrypted: new TextEncoder().encode('Draft subject'),
          updatedAt: now,
        },
        {
          id: 'draft-002',
          toAddresses: [],
          subjectEncrypted: null,
          updatedAt: now,
        },
      ]);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/drafts', { method: 'GET' });

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        data: Array<{ id: string; to: string[]; subject: string | null; updatedAt: string }>;
      };
      expect(json.data).toHaveLength(2);
      expect(json.data[0]!.id).toBe('draft-001');
      expect(json.data[0]!.to).toEqual(['bob@example.com']);
      expect(json.data[0]!.subject).toBe('Draft subject');
      expect(json.data[1]!.subject).toBeNull();
    });

    test('returns empty list when drafts mailbox does not exist', async () => {
      selectWhereMock.mockImplementationOnce(async () => []);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/drafts', { method: 'GET' });

      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: unknown[] };
      expect(json.data).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // PUT /compose/draft/:id
  // -----------------------------------------------------------------------

  describe('PUT /compose/draft/:id', () => {
    test('updates an existing draft', async () => {
      selectWhereMock
        .mockImplementationOnce(async () => [{ id: DRAFTS_MAILBOX_ID }])
        .mockImplementationOnce(async () => [{ id: 'draft-001' }]);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft/draft-001', {
        method: 'PUT',
        body: JSON.stringify({
          to: ['bob@example.com'],
          subject: 'Updated subject',
        }),
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: { id: string } };
      expect(json.data.id).toBe('draft-001');
    });

    test('returns 404 for non-existent draft', async () => {
      selectWhereMock
        .mockImplementationOnce(async () => [{ id: DRAFTS_MAILBOX_ID }])
        .mockImplementationOnce(async () => []);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ subject: 'test' }),
      });

      expect(response.status).toBe(404);
    });

    test('returns 404 when drafts mailbox does not exist', async () => {
      selectWhereMock.mockImplementationOnce(async () => []);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft/draft-001', {
        method: 'PUT',
        body: JSON.stringify({ subject: 'test' }),
      });

      expect(response.status).toBe(404);
    });

    test('rejects invalid email addresses in update', async () => {
      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft/draft-001', {
        method: 'PUT',
        body: JSON.stringify({ to: ['not-an-email'] }),
      });

      expect(response.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /compose/draft/:id
  // -----------------------------------------------------------------------

  describe('DELETE /compose/draft/:id', () => {
    test('hard deletes an existing draft', async () => {
      selectWhereMock
        .mockImplementationOnce(async () => [{ id: DRAFTS_MAILBOX_ID }])
        .mockImplementationOnce(async () => [{ id: 'draft-001' }]);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft/draft-001', {
        method: 'DELETE',
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: { success: boolean } };
      expect(json.data.success).toBe(true);
      expect(deleteWhereMock).toHaveBeenCalled();
    });

    test('returns 404 for non-existent draft', async () => {
      selectWhereMock
        .mockImplementationOnce(async () => [{ id: DRAFTS_MAILBOX_ID }])
        .mockImplementationOnce(async () => []);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft/nonexistent', {
        method: 'DELETE',
      });

      expect(response.status).toBe(404);
    });

    test('returns 404 when drafts mailbox does not exist', async () => {
      selectWhereMock.mockImplementationOnce(async () => []);

      const router = createRouter();
      const response = await makeRequest(router, '/compose/draft/draft-001', {
        method: 'DELETE',
      });

      expect(response.status).toBe(404);
    });
  });
});
