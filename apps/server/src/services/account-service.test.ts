import { Buffer } from 'node:buffer';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { AccountServiceError, createAccountService } from './account-service.js';

type DbUser = {
  id: string;
  email: string;
  srpSalt: Buffer;
  srpVerifier: Buffer;
  keyExportConfirmed: boolean;
  isAdmin: boolean;
};

type DbKeypair = {
  userId: string;
  type: 'x25519' | 'ed25519';
  publicKey: Buffer;
  encryptedPrivateKey: Buffer;
  isActive: boolean;
};

type DbMailbox = {
  userId: string;
  name: string;
  type: 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive';
  uidValidity: number;
  uidNext: number;
};

type InMemoryStore = {
  users: DbUser[];
  keypairs: DbKeypair[];
  mailboxes: DbMailbox[];
};

const createStore = (): InMemoryStore => ({ users: [], keypairs: [], mailboxes: [] });

const cloneStore = (source: InMemoryStore): InMemoryStore => ({
  users: source.users.map((user) => ({ ...user })),
  keypairs: source.keypairs.map((keypair) => ({ ...keypair })),
  mailboxes: source.mailboxes.map((mailbox) => ({ ...mailbox })),
});

const collectStrings = (value: unknown, seen: Set<object> = new Set()): string[] => {
  if (typeof value === 'string') {
    return [value];
  }

  if (value === null || typeof value !== 'object') {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStrings(entry, seen));
  }

  return Object.values(value).flatMap((entry) => collectStrings(entry, seen));
};

describe('createAccountService', () => {
  let nextUserId = 1;
  let failOnKeypairInsert = false;
  let store: InMemoryStore;

  const createSessionMock = mock(
    async (userId: string): Promise<{ token: string; expiresAt: Date }> => ({
      token: `session-${userId}`,
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
    }),
  );

  const createService = () => {
    const dbClient = {
      select: () => ({
        from: () => ({
          where: async (whereClause: unknown): Promise<Array<{ id: string }>> => {
            const whereStrings = collectStrings(whereClause);
            const found = store.users.find((user) => whereStrings.includes(user.email));
            return found ? [{ id: found.id }] : [];
          },
        }),
      }),
      transaction: async <TResult>(
        callback: (tx: unknown) => Promise<TResult>,
      ): Promise<TResult> => {
        const staged = cloneStore(store);

        const tx = {
          select: () => ({
            from: async (): Promise<Array<{ id: string }>> =>
              staged.users.map((user) => ({ id: user.id })),
          }),
          insert: (table: unknown) => ({
            values: (rows: unknown) => {
              if (
                table &&
                typeof table === 'object' &&
                'email' in (table as Record<string, unknown>)
              ) {
                const user = rows as {
                  email: string;
                  srpSalt: Buffer;
                  srpVerifier: Buffer;
                  keyExportConfirmed: boolean;
                  isAdmin: boolean;
                };

                const inserted: DbUser = {
                  id: `user-${nextUserId}`,
                  email: user.email,
                  srpSalt: user.srpSalt,
                  srpVerifier: user.srpVerifier,
                  keyExportConfirmed: user.keyExportConfirmed,
                  isAdmin: user.isAdmin,
                };

                nextUserId += 1;
                staged.users.push(inserted);

                return {
                  returning: async (): Promise<Array<{ id: string }>> => [{ id: inserted.id }],
                };
              }

              const rowsArray = rows as DbKeypair[] | DbMailbox[];

              if (
                Array.isArray(rowsArray) &&
                rowsArray.length > 0 &&
                'encryptedPrivateKey' in rowsArray[0]!
              ) {
                if (failOnKeypairInsert) {
                  throw new Error('simulated keypair insert failure');
                }

                staged.keypairs.push(...(rowsArray as DbKeypair[]));
                return Promise.resolve(rowsArray);
              }

              staged.mailboxes.push(...(rowsArray as DbMailbox[]));
              return Promise.resolve(rowsArray);
            },
          }),
        };

        const result = await callback(tx);
        store = staged;
        return result;
      },
    };

    return createAccountService({
      dbClient: dbClient as Parameters<typeof createAccountService>[0]['dbClient'],
      createSessionFn: createSessionMock,
      nowFn: () => 1_700_000_000_000,
    });
  };

  beforeEach(() => {
    nextUserId = 1;
    failOnKeypairInsert = false;
    store = createStore();
    createSessionMock.mockClear();
  });

  test('creates user, keypairs, and default mailboxes successfully', async () => {
    const service = createService();

    const result = await service({
      email: 'Alice@Enclave.Test',
      salt: '0a0b0c0d',
      verifier: '01020304',
      x25519Public: '11'.repeat(32),
      ed25519Public: '22'.repeat(32),
      encryptedX25519Private: '33'.repeat(96),
      encryptedEd25519Private: '44'.repeat(96),
    });

    expect(result).toEqual({ userId: 'user-1', sessionToken: 'session-user-1' });
    expect(store.users).toHaveLength(1);
    expect(store.keypairs).toHaveLength(2);
    expect(store.mailboxes).toHaveLength(5);
    expect(createSessionMock).toHaveBeenCalledWith('user-1');
  });

  test('rejects duplicate email with EMAIL_TAKEN', async () => {
    const service = createService();

    store.users.push({
      id: 'user-existing',
      email: 'alice@enclave.test',
      srpSalt: Buffer.from('aa', 'hex'),
      srpVerifier: Buffer.from('bb', 'hex'),
      keyExportConfirmed: false,
      isAdmin: false,
    });

    await expect(
      service({
        email: 'Alice@Enclave.Test',
        salt: '0a0b0c0d',
        verifier: '01020304',
        x25519Public: '11'.repeat(32),
        ed25519Public: '22'.repeat(32),
        encryptedX25519Private: '33'.repeat(96),
        encryptedEd25519Private: '44'.repeat(96),
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  test('rolls back when transaction fails mid-flight', async () => {
    const service = createService();
    failOnKeypairInsert = true;

    await expect(
      service({
        email: 'alice@enclave.test',
        salt: '0a0b0c0d',
        verifier: '01020304',
        x25519Public: '11'.repeat(32),
        ed25519Public: '22'.repeat(32),
        encryptedX25519Private: '33'.repeat(96),
        encryptedEd25519Private: '44'.repeat(96),
      }),
    ).rejects.toBeInstanceOf(AccountServiceError);

    expect(store.users).toHaveLength(0);
    expect(store.keypairs).toHaveLength(0);
    expect(store.mailboxes).toHaveLength(0);
    expect(createSessionMock).toHaveBeenCalledTimes(0);
  });

  test('auto-promotes the first registered user to admin', async () => {
    const service = createService();

    await service({
      email: 'first@enclave.test',
      salt: '0a0b0c0d',
      verifier: '01020304',
      x25519Public: '11'.repeat(32),
      ed25519Public: '22'.repeat(32),
      encryptedX25519Private: '33'.repeat(96),
      encryptedEd25519Private: '44'.repeat(96),
    });

    expect(store.users).toHaveLength(1);
    expect(store.users[0]?.isAdmin).toBe(true);
  });

  test('creates subsequent users with explicit non-admin role', async () => {
    const service = createService();

    await service({
      email: 'first@enclave.test',
      salt: '0a0b0c0d',
      verifier: '01020304',
      x25519Public: '11'.repeat(32),
      ed25519Public: '22'.repeat(32),
      encryptedX25519Private: '33'.repeat(96),
      encryptedEd25519Private: '44'.repeat(96),
    });

    await service({
      email: 'second@enclave.test',
      salt: '0a0b0c0d',
      verifier: '01020304',
      x25519Public: '55'.repeat(32),
      ed25519Public: '66'.repeat(32),
      encryptedX25519Private: '77'.repeat(96),
      encryptedEd25519Private: '88'.repeat(96),
    });

    expect(store.users).toHaveLength(2);
    expect(store.users[0]?.isAdmin).toBe(true);
    expect(store.users[1]?.isAdmin).toBe(false);
  });
});
