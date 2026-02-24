import { Buffer } from 'node:buffer';

import { db, keypairs, mailboxes, users } from '@enclave/db';
import { eq } from 'drizzle-orm';

import { createSession } from '../middleware/session.js';

const HEX_REGEX = /^[0-9a-f]+$/i;
const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type AccountServiceErrorCode =
  | 'EMAIL_TAKEN'
  | 'INVALID_KEY_SIZE'
  | 'INVALID_KEY_ENCODING'
  | 'ACCOUNT_CREATION_FAILED';

export class AccountServiceError extends Error {
  public readonly code: AccountServiceErrorCode;

  public constructor(code: AccountServiceErrorCode, message: string) {
    super(message);
    this.name = 'AccountServiceError';
    this.code = code;
  }
}

export interface CreateAccountInput {
  email: string;
  salt: string;
  verifier: string;
  x25519Public: string;
  ed25519Public: string;
  encryptedX25519Private: string;
  encryptedEd25519Private: string;
}

export interface CreateAccountResult {
  userId: string;
  sessionToken: string;
}

interface SelectUsersQuery {
  from: (table: unknown) => {
    where: (whereClause: unknown) => Promise<Array<{ id: string }>>;
  };
}

interface InsertUsersQuery {
  values: (row: {
    email: string;
    srpSalt: Buffer;
    srpVerifier: Buffer;
    keyExportConfirmed: boolean;
  }) => {
    returning: (selection: { id: unknown }) => Promise<Array<{ id: string }>>;
  };
}

interface InsertBatchQuery {
  values: (rows: unknown[]) => Promise<unknown>;
}

interface AccountTransactionClient {
  insert: (table: unknown) => InsertUsersQuery | InsertBatchQuery;
}

interface AccountDbClient {
  select: (selection: { id: unknown }) => SelectUsersQuery;
  transaction: <TResult>(
    callback: (tx: AccountTransactionClient) => Promise<TResult>,
  ) => Promise<TResult>;
}

interface AccountServiceDeps {
  dbClient: AccountDbClient;
  createSessionFn: (userId: string) => Promise<{ token: string; expiresAt: Date }>;
  nowFn: () => number;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const decodeHex = (value: string, field: string): Buffer => {
  if (!HEX_REGEX.test(value) || value.length === 0 || value.length % 2 !== 0) {
    throw new AccountServiceError('INVALID_KEY_ENCODING', `Invalid hex for ${field}`);
  }

  return Buffer.from(value, 'hex');
};

const decodeHexOrBase64 = (value: string, field: string): Buffer => {
  if (HEX_REGEX.test(value) && value.length > 0 && value.length % 2 === 0) {
    return Buffer.from(value, 'hex');
  }

  if (BASE64_REGEX.test(value) && value.length > 0) {
    return Buffer.from(value, 'base64');
  }

  throw new AccountServiceError('INVALID_KEY_ENCODING', `Invalid encoding for ${field}`);
};

const assertLength = (value: Buffer, expectedBytes: number, field: string): void => {
  if (value.length !== expectedBytes) {
    throw new AccountServiceError(
      'INVALID_KEY_SIZE',
      `${field} must be exactly ${expectedBytes} bytes`,
    );
  }
};

export const createAccountService = (deps: AccountServiceDeps) => {
  return async (input: CreateAccountInput): Promise<CreateAccountResult> => {
    const email = normalizeEmail(input.email);
    const existing = await deps.dbClient
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));

    if (existing.length > 0) {
      throw new AccountServiceError('EMAIL_TAKEN', 'Email already exists');
    }

    const salt = decodeHex(input.salt, 'salt');
    const verifier = decodeHex(input.verifier, 'verifier');
    const x25519Public = decodeHexOrBase64(input.x25519Public, 'x25519_public');
    const ed25519Public = decodeHexOrBase64(input.ed25519Public, 'ed25519_public');
    const encryptedX25519Private = decodeHexOrBase64(
      input.encryptedX25519Private,
      'encrypted_x25519_private',
    );
    const encryptedEd25519Private = decodeHexOrBase64(
      input.encryptedEd25519Private,
      'encrypted_ed25519_private',
    );

    assertLength(x25519Public, 32, 'x25519_public');
    assertLength(ed25519Public, 32, 'ed25519_public');

    let userId: string;

    try {
      userId = await deps.dbClient.transaction(async (tx) => {
        const userInsert = tx.insert(users) as InsertUsersQuery;

        const createdUsers = await userInsert
          .values({
            email,
            srpSalt: salt,
            srpVerifier: verifier,
            keyExportConfirmed: false,
          })
          .returning({ id: users.id });

        const createdUser = createdUsers[0];
        if (!createdUser) {
          throw new Error('Failed to insert user');
        }

        const keypairInsert = tx.insert(keypairs) as InsertBatchQuery;

        await keypairInsert.values([
          {
            userId: createdUser.id,
            type: 'x25519',
            publicKey: x25519Public,
            encryptedPrivateKey: encryptedX25519Private,
            isActive: true,
          },
          {
            userId: createdUser.id,
            type: 'ed25519',
            publicKey: ed25519Public,
            encryptedPrivateKey: encryptedEd25519Private,
            isActive: true,
          },
        ]);

        const mailboxInsert = tx.insert(mailboxes) as InsertBatchQuery;
        const uidValidity = Math.floor(deps.nowFn() / 1000);

        await mailboxInsert.values([
          {
            userId: createdUser.id,
            name: 'INBOX',
            type: 'inbox',
            uidValidity,
            uidNext: 1,
          },
          {
            userId: createdUser.id,
            name: 'Sent',
            type: 'sent',
            uidValidity,
            uidNext: 1,
          },
          {
            userId: createdUser.id,
            name: 'Drafts',
            type: 'drafts',
            uidValidity,
            uidNext: 1,
          },
          {
            userId: createdUser.id,
            name: 'Trash',
            type: 'trash',
            uidValidity,
            uidNext: 1,
          },
          {
            userId: createdUser.id,
            name: 'Archive',
            type: 'archive',
            uidValidity,
            uidNext: 1,
          },
        ]);

        return createdUser.id;
      });
    } catch (error) {
      if (error instanceof AccountServiceError) {
        throw error;
      }

      throw new AccountServiceError(
        'ACCOUNT_CREATION_FAILED',
        'Account creation transaction failed',
      );
    }

    const session = await deps.createSessionFn(userId);

    return {
      userId,
      sessionToken: session.token,
    };
  };
};

export const createAccount = createAccountService({
  dbClient: db as unknown as AccountDbClient,
  createSessionFn: createSession,
  nowFn: () => Date.now(),
});
