import { db, users } from '@enclave/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthVariables } from '../middleware/auth.js';
import { AccountServiceError, createAccount } from '../services/account-service.js';

const hexRegex = /^[0-9a-f]+$/i;

const accountCreateSchema = z.object({
  email: z.string().email(),
  salt: z
    .string()
    .regex(hexRegex)
    .refine((value) => value.length % 2 === 0),
  verifier: z
    .string()
    .regex(hexRegex)
    .refine((value) => value.length % 2 === 0),
  x25519_public: z.string().min(1),
  ed25519_public: z.string().min(1),
  encrypted_x25519_private: z.string().min(1),
  encrypted_ed25519_private: z.string().min(1),
});

interface AccountRouteDeps {
  createAccountFn: typeof createAccount;
  confirmKeyExportFn: (userId: string) => Promise<void>;
}

export const createAccountRouter = (deps: AccountRouteDeps): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.post('/account/create', async (c) => {
    let body: unknown;

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_REQUEST', details: [{ message: 'Invalid JSON body' }] }, 400);
    }

    const parsed = accountCreateSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'INVALID_REQUEST', details: parsed.error.issues }, 400);
    }

    try {
      const result = await deps.createAccountFn({
        email: parsed.data.email,
        salt: parsed.data.salt,
        verifier: parsed.data.verifier,
        x25519Public: parsed.data.x25519_public,
        ed25519Public: parsed.data.ed25519_public,
        encryptedX25519Private: parsed.data.encrypted_x25519_private,
        encryptedEd25519Private: parsed.data.encrypted_ed25519_private,
      });

      return c.json(result, 200);
    } catch (error) {
      if (error instanceof AccountServiceError) {
        if (error.code === 'EMAIL_TAKEN') {
          return c.json({ error: 'EMAIL_TAKEN' }, 409);
        }

        if (error.code === 'INVALID_KEY_ENCODING' || error.code === 'INVALID_KEY_SIZE') {
          return c.json({ error: 'INVALID_REQUEST', details: [{ message: error.message }] }, 400);
        }
      }

      console.error('account-create-failed', error);
      return c.json({ error: 'ACCOUNT_CREATION_FAILED' }, 500);
    }
  });

  router.post('/account/confirm-key-export', async (c) => {
    const userId = c.get('userId');

    try {
      await deps.confirmKeyExportFn(userId);
      return c.json({ success: true }, 200);
    } catch (error) {
      console.error('confirm-key-export-failed', error);
      return c.json({ error: 'INTERNAL_ERROR' }, 500);
    }
  });

  return router;
};

// ---------------------------------------------------------------------------
// Default instance wired to real dependencies
// ---------------------------------------------------------------------------

const confirmKeyExport = async (userId: string): Promise<void> => {
  await db.update(users).set({ keyExportConfirmed: true }).where(eq(users.id, userId));
};

export const accountRouter = createAccountRouter({
  createAccountFn: createAccount,
  confirmKeyExportFn: confirmKeyExport,
});
