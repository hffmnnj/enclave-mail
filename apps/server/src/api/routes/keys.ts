import { Buffer } from 'node:buffer';

import { getFingerprint } from '@enclave/crypto';
import { db, keypairs, prekeys } from '@enclave/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthVariables } from '../../middleware/auth.js';
import { authMiddleware } from '../../middleware/auth.js';
import type { ApiError, ApiResponse } from '../types.js';

const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const rotateKeysSchema = z.object({
  x25519PublicKey: z.string().min(1),
  x25519EncryptedPrivateKey: z.string().min(1),
  ed25519PublicKey: z.string().min(1),
  ed25519EncryptedPrivateKey: z.string().min(1),
});

const prekeyUploadSchema = z.object({
  signedPrekey: z.object({
    keyId: z.number().int().nonnegative(),
    publicKey: z.string().min(1),
    signature: z.string().min(1),
  }),
  oneTimePrekeys: z
    .array(
      z.object({
        keyId: z.number().int().nonnegative(),
        publicKey: z.string().min(1),
      }),
    )
    .optional(),
});

type DbKeypairRow = {
  type: 'x25519' | 'ed25519';
  publicKey: Buffer;
  encryptedPrivateKey: Buffer;
  createdAt: Date;
  isActive: boolean;
};

type DbPrekeyRow = {
  id: string;
  userId: string;
  keyId: number;
  publicKey: Buffer;
  signature: Buffer | null;
  keyType: 'signed' | 'one_time';
  isUsed: boolean;
  createdAt: Date;
};

type ActiveKeyData = {
  x25519: DbKeypairRow;
  ed25519: DbKeypairRow;
};

type RotateKeysInput = z.infer<typeof rotateKeysSchema>;
type PrekeyUploadInput = z.infer<typeof prekeyUploadSchema>;

type OwnKeysResponse = {
  x25519: {
    publicKey: string;
    fingerprint: string;
    createdAt: string;
    isActive: boolean;
  };
  ed25519: {
    publicKey: string;
    fingerprint: string;
    createdAt: string;
    isActive: boolean;
  };
};

type ExportKeysResponse = {
  x25519PublicKey: string;
  x25519EncryptedPrivateKey: string;
  ed25519PublicKey: string;
  ed25519EncryptedPrivateKey: string;
};

type PublicKeysResponse = {
  userId: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
};

type PrekeyBundleResponse = {
  identityKey: string;
  signedPrekey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  oneTimePrekey?: {
    keyId: number;
    publicKey: string;
  };
};

const toBase64 = (bytes: Buffer | Uint8Array): string => {
  return Buffer.from(bytes).toString('base64');
};

const decodeBase64 = (value: string, field: string): Buffer => {
  if (!BASE64_REGEX.test(value) || value.length === 0) {
    throw new Error(`Invalid base64 for ${field}`);
  }

  return Buffer.from(value, 'base64');
};

const decodeKey = (value: string, field: string): Buffer => {
  const decoded = decodeBase64(value, field);
  if (decoded.length !== 32) {
    throw new Error(`${field} must be exactly 32 bytes`);
  }
  return decoded;
};

const getActiveKeyData = (rows: DbKeypairRow[]): ActiveKeyData | null => {
  let x25519: DbKeypairRow | undefined;
  let ed25519: DbKeypairRow | undefined;

  for (const row of rows) {
    if (row.type === 'x25519' && !x25519) {
      x25519 = row;
    }
    if (row.type === 'ed25519' && !ed25519) {
      ed25519 = row;
    }
  }

  if (!x25519 || !ed25519) {
    return null;
  }

  return { x25519, ed25519 };
};

export interface KeysRouteDeps {
  fetchActiveKeys: (userId: string) => Promise<ActiveKeyData | null>;
  rotateKeys: (userId: string, input: RotateKeysInput) => Promise<void>;
  insertPrekeys: (userId: string, input: PrekeyUploadInput) => Promise<void>;
  fetchPrekeyBundle: (userId: string) => Promise<PrekeyBundleResponse | null>;
}

const defaultDeps: KeysRouteDeps = {
  fetchActiveKeys: async (userId) => {
    const rows = await db
      .select({
        type: keypairs.type,
        publicKey: keypairs.publicKey,
        encryptedPrivateKey: keypairs.encryptedPrivateKey,
        createdAt: keypairs.createdAt,
        isActive: keypairs.isActive,
      })
      .from(keypairs)
      .where(and(eq(keypairs.userId, userId), eq(keypairs.isActive, true)))
      .orderBy(desc(keypairs.createdAt));

    return getActiveKeyData(rows as DbKeypairRow[]);
  },

  rotateKeys: async (userId, input) => {
    const x25519Public = decodeKey(input.x25519PublicKey, 'x25519PublicKey');
    const ed25519Public = decodeKey(input.ed25519PublicKey, 'ed25519PublicKey');
    const x25519EncryptedPrivate = decodeBase64(
      input.x25519EncryptedPrivateKey,
      'x25519EncryptedPrivateKey',
    );
    const ed25519EncryptedPrivate = decodeBase64(
      input.ed25519EncryptedPrivateKey,
      'ed25519EncryptedPrivateKey',
    );

    await db.transaction(async (tx) => {
      await tx
        .update(keypairs)
        .set({ isActive: false })
        .where(and(eq(keypairs.userId, userId), eq(keypairs.isActive, true)));

      await tx.insert(keypairs).values([
        {
          userId,
          type: 'x25519',
          publicKey: x25519Public,
          encryptedPrivateKey: x25519EncryptedPrivate,
          isActive: true,
        },
        {
          userId,
          type: 'ed25519',
          publicKey: ed25519Public,
          encryptedPrivateKey: ed25519EncryptedPrivate,
          isActive: true,
        },
      ]);
    });
  },

  insertPrekeys: async (userId, input) => {
    const signedPublicKey = decodeKey(input.signedPrekey.publicKey, 'signedPrekey.publicKey');
    const signedSignature = decodeBase64(input.signedPrekey.signature, 'signedPrekey.signature');

    await db.insert(prekeys).values({
      userId,
      keyId: input.signedPrekey.keyId,
      publicKey: signedPublicKey,
      signature: signedSignature,
      keyType: 'signed',
      isUsed: false,
    });

    if (!input.oneTimePrekeys || input.oneTimePrekeys.length === 0) {
      return;
    }

    const rows = input.oneTimePrekeys.map((entry) => ({
      userId,
      keyId: entry.keyId,
      publicKey: decodeKey(entry.publicKey, 'oneTimePrekey.publicKey'),
      signature: null,
      keyType: 'one_time' as const,
      isUsed: false,
    }));

    await db.insert(prekeys).values(rows);
  },

  fetchPrekeyBundle: async (userId) => {
    const keys = await db
      .select({
        type: keypairs.type,
        publicKey: keypairs.publicKey,
        encryptedPrivateKey: keypairs.encryptedPrivateKey,
        createdAt: keypairs.createdAt,
        isActive: keypairs.isActive,
      })
      .from(keypairs)
      .where(and(eq(keypairs.userId, userId), eq(keypairs.isActive, true)))
      .orderBy(desc(keypairs.createdAt));

    const active = getActiveKeyData(keys as DbKeypairRow[]);
    if (!active) {
      return null;
    }

    const signedRows = await db
      .select({
        id: prekeys.id,
        userId: prekeys.userId,
        keyId: prekeys.keyId,
        publicKey: prekeys.publicKey,
        signature: prekeys.signature,
        keyType: prekeys.keyType,
        isUsed: prekeys.isUsed,
        createdAt: prekeys.createdAt,
      })
      .from(prekeys)
      .where(
        and(eq(prekeys.userId, userId), eq(prekeys.keyType, 'signed'), eq(prekeys.isUsed, false)),
      )
      .orderBy(desc(prekeys.createdAt))
      .limit(1);

    const signed = signedRows[0] as DbPrekeyRow | undefined;
    if (!signed || !signed.signature) {
      return null;
    }

    const oneTimeRows = await db
      .select({
        id: prekeys.id,
        userId: prekeys.userId,
        keyId: prekeys.keyId,
        publicKey: prekeys.publicKey,
        signature: prekeys.signature,
        keyType: prekeys.keyType,
        isUsed: prekeys.isUsed,
        createdAt: prekeys.createdAt,
      })
      .from(prekeys)
      .where(
        and(eq(prekeys.userId, userId), eq(prekeys.keyType, 'one_time'), eq(prekeys.isUsed, false)),
      )
      .orderBy(prekeys.createdAt)
      .limit(1);

    const candidate = oneTimeRows[0] as DbPrekeyRow | undefined;
    let consumedOneTime: DbPrekeyRow | null = null;

    if (candidate) {
      const updatedRows = await db
        .update(prekeys)
        .set({ isUsed: true })
        .where(and(eq(prekeys.id, candidate.id), eq(prekeys.isUsed, false)))
        .returning({
          id: prekeys.id,
          userId: prekeys.userId,
          keyId: prekeys.keyId,
          publicKey: prekeys.publicKey,
          signature: prekeys.signature,
          keyType: prekeys.keyType,
          isUsed: prekeys.isUsed,
          createdAt: prekeys.createdAt,
        });

      consumedOneTime = (updatedRows[0] as DbPrekeyRow | undefined) ?? null;
    }

    const bundleBase: PrekeyBundleResponse = {
      identityKey: toBase64(active.ed25519.publicKey),
      signedPrekey: {
        keyId: signed.keyId,
        publicKey: toBase64(signed.publicKey),
        signature: toBase64(signed.signature),
      },
    };

    if (!consumedOneTime) {
      return bundleBase;
    }

    return {
      ...bundleBase,
      oneTimePrekey: {
        keyId: consumedOneTime.keyId,
        publicKey: toBase64(consumedOneTime.publicKey),
      },
    };
  },
};

export const createKeysRouter = (
  deps: KeysRouteDeps = defaultDeps,
): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.get('/keys', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const active = await deps.fetchActiveKeys(userId);

    if (!active) {
      const body: ApiError = { error: 'Keys not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const body: ApiResponse<OwnKeysResponse> = {
      data: {
        x25519: {
          publicKey: toBase64(active.x25519.publicKey),
          fingerprint: getFingerprint(active.x25519.publicKey),
          createdAt: active.x25519.createdAt.toISOString(),
          isActive: active.x25519.isActive,
        },
        ed25519: {
          publicKey: toBase64(active.ed25519.publicKey),
          fingerprint: getFingerprint(active.ed25519.publicKey),
          createdAt: active.ed25519.createdAt.toISOString(),
          isActive: active.ed25519.isActive,
        },
      },
    };

    return c.json(body, 200);
  });

  router.get('/keys/export', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const active = await deps.fetchActiveKeys(userId);

    if (!active) {
      const body: ApiError = { error: 'Keys not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const body: ApiResponse<ExportKeysResponse> = {
      data: {
        x25519PublicKey: toBase64(active.x25519.publicKey),
        x25519EncryptedPrivateKey: toBase64(active.x25519.encryptedPrivateKey),
        ed25519PublicKey: toBase64(active.ed25519.publicKey),
        ed25519EncryptedPrivateKey: toBase64(active.ed25519.encryptedPrivateKey),
      },
    };

    return c.json(body, 200);
  });

  router.post('/keys/rotate', authMiddleware, async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      const body: ApiError = { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' };
      return c.json(body, 400);
    }

    const parsed = rotateKeysSchema.safeParse(rawBody);
    if (!parsed.success) {
      const body: ApiError = {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      };
      return c.json(body, 400);
    }

    try {
      await deps.rotateKeys(c.get('userId'), parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate keys';
      const body: ApiError = { error: message, code: 'VALIDATION_ERROR' };
      return c.json(body, 400);
    }

    const body: ApiResponse<{ success: true; rotatedAt: string }> = {
      data: { success: true, rotatedAt: new Date().toISOString() },
    };

    return c.json(body, 200);
  });

  router.get('/keys/:userId/public', async (c) => {
    const userId = c.req.param('userId');
    const active = await deps.fetchActiveKeys(userId);

    if (!active) {
      const body: ApiError = { error: 'User keys not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const body: ApiResponse<PublicKeysResponse> = {
      data: {
        userId,
        x25519PublicKey: toBase64(active.x25519.publicKey),
        ed25519PublicKey: toBase64(active.ed25519.publicKey),
        fingerprint: getFingerprint(active.ed25519.publicKey),
      },
    };

    return c.json(body, 200);
  });

  router.post('/keys/prekeys', authMiddleware, async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      const body: ApiError = { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' };
      return c.json(body, 400);
    }

    const parsed = prekeyUploadSchema.safeParse(rawBody);
    if (!parsed.success) {
      const body: ApiError = {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      };
      return c.json(body, 400);
    }

    try {
      await deps.insertPrekeys(c.get('userId'), parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload prekeys';
      const body: ApiError = { error: message, code: 'VALIDATION_ERROR' };
      return c.json(body, 400);
    }

    const body: ApiResponse<{ success: true }> = { data: { success: true } };
    return c.json(body, 200);
  });

  router.get('/keys/prekeys/:userId', async (c) => {
    const userId = c.req.param('userId');
    const bundle = await deps.fetchPrekeyBundle(userId);

    if (!bundle) {
      const body: ApiError = { error: 'Prekey bundle not found', code: 'NOT_FOUND' };
      return c.json(body, 404);
    }

    const body: ApiResponse<PrekeyBundleResponse> = { data: bundle };
    return c.json(body, 200);
  });

  return router;
};

export const keysRouter = createKeysRouter();
