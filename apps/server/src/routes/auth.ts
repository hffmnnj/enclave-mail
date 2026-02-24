import { Buffer } from 'node:buffer';

import { srpDeriveServerSession, srpGenerateServerEphemeral } from '@enclave/crypto';
import { db, users } from '@enclave/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import { authRateLimit } from '../middleware/rate-limit.js';
import { createSession, invalidateSession } from '../middleware/session.js';
import { redis } from '../queue/connection.js';

const AUTH_FAILED_ERROR = { error: 'AUTH_FAILED' } as const;
const SRP_STATE_TTL_SECONDS = 30;

const registerSchema = z.object({
  email: z.string().email(),
  salt: z.string().regex(/^[0-9a-f]+$/i),
  verifier: z.string().regex(/^[0-9a-f]+$/i),
});

const loginStartSchema = z.object({
  email: z.string().email(),
  A: z.string().regex(/^[0-9a-f]+$/i),
});

const loginFinishSchema = z.object({
  email: z.string().email(),
  clientProof: z.string().regex(/^[0-9a-f]+$/i),
});

const unauthorized = (c: Context) => {
  return c.json(AUTH_FAILED_ERROR, 401);
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const srpStateKey = (email: string): string => `srp:${normalizeEmail(email)}`;

const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('Invalid hex');
  }

  return new Uint8Array(Buffer.from(hex, 'hex'));
};

const bytesToHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const parseBody = async <TSchema extends z.ZodTypeAny>(
  c: Context,
  schema: TSchema,
): Promise<z.infer<TSchema> | null> => {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return null;
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
};

interface StoredSrpState {
  userId: string;
  email: string;
  salt: string;
  verifier: string;
  clientPublicEphemeral: string;
  serverPublicEphemeral: string;
  serverSecretEphemeral: string;
}

export const authRouter = new Hono();

authRouter.post('/auth/register', authRateLimit, async (c) => {
  const payload = await parseBody(c, registerSchema);
  if (!payload) {
    return c.json({ error: 'INVALID_BODY' }, 400);
  }

  const email = normalizeEmail(payload.email);

  const existingUsers = await db.select({ id: users.id }).from(users).where(eq(users.email, email));

  if (existingUsers.length > 0) {
    return c.json({ error: 'EMAIL_TAKEN' }, 409);
  }

  let salt: Uint8Array;
  let verifier: Uint8Array;

  try {
    salt = hexToBytes(payload.salt);
    verifier = hexToBytes(payload.verifier);
  } catch {
    return c.json({ error: 'INVALID_BODY' }, 400);
  }

  const inserted = await db
    .insert(users)
    .values({
      email,
      srpSalt: salt,
      srpVerifier: verifier,
    })
    .returning({ id: users.id });

  const user = inserted[0];
  if (!user) {
    return c.json({ error: 'REGISTER_FAILED' }, 500);
  }

  return c.json({ userId: user.id }, 200);
});

authRouter.post('/auth/login/start', authRateLimit, async (c) => {
  const payload = await parseBody(c, loginStartSchema);
  if (!payload) {
    return c.json({ error: 'INVALID_BODY' }, 400);
  }

  const email = normalizeEmail(payload.email);
  const usersByEmail = await db
    .select({ id: users.id, srpSalt: users.srpSalt, srpVerifier: users.srpVerifier })
    .from(users)
    .where(eq(users.email, email));

  const user = usersByEmail[0];
  if (!user) {
    return unauthorized(c);
  }

  const salt = bytesToHex(user.srpSalt);
  const verifier = bytesToHex(user.srpVerifier);

  try {
    const serverEphemeral = srpGenerateServerEphemeral(verifier);

    const state: StoredSrpState = {
      userId: user.id,
      email,
      salt,
      verifier,
      clientPublicEphemeral: payload.A,
      serverPublicEphemeral: serverEphemeral.public,
      serverSecretEphemeral: serverEphemeral.secret,
    };

    await redis.set(srpStateKey(email), JSON.stringify(state), 'EX', SRP_STATE_TTL_SECONDS);

    return c.json({ B: serverEphemeral.public, salt }, 200);
  } catch {
    return unauthorized(c);
  }
});

authRouter.post('/auth/login/finish', authRateLimit, async (c) => {
  const payload = await parseBody(c, loginFinishSchema);
  if (!payload) {
    return c.json({ error: 'INVALID_BODY' }, 400);
  }

  const email = normalizeEmail(payload.email);
  const stateKey = srpStateKey(email);
  const rawState = await redis.get(stateKey);

  if (!rawState) {
    return unauthorized(c);
  }

  let state: StoredSrpState;

  try {
    state = JSON.parse(rawState) as StoredSrpState;
  } catch {
    await redis.del(stateKey);
    return unauthorized(c);
  }

  try {
    const serverSession = srpDeriveServerSession(
      {
        public: state.serverPublicEphemeral,
        secret: state.serverSecretEphemeral,
      },
      state.clientPublicEphemeral,
      state.salt,
      state.email,
      state.verifier,
      payload.clientProof,
    );

    await redis.del(stateKey);
    const session = await createSession(state.userId);

    return c.json(
      {
        sessionToken: session.token,
        serverProof: serverSession.proof,
      },
      200,
    );
  } catch {
    await redis.del(stateKey);
    return unauthorized(c);
  }
});

authRouter.post('/auth/logout', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorized(c);
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return unauthorized(c);
  }

  await invalidateSession(token);
  return c.body(null, 204);
});
