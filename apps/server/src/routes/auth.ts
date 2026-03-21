import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

import { srpDeriveServerSession, srpGenerateServerEphemeral } from '@enclave/crypto';
import { db, users } from '@enclave/db';
import { and, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AuthVariables } from '../middleware/auth.js';
import { authMiddleware } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import { createSession, invalidateSession } from '../middleware/session.js';
import { redis } from '../queue/connection.js';

const AUTH_FAILED_ERROR = { error: 'AUTH_FAILED' } as const;
const SRP_STATE_TTL_SECONDS = 30;
const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;

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

// ---------------------------------------------------------------------------
// Email verification helpers
// ---------------------------------------------------------------------------

const isVerificationRequired = (): boolean => process.env.REQUIRE_EMAIL_VERIFICATION !== 'false';

const generateVerificationToken = (): string => randomBytes(32).toString('hex');

const generateVerificationExpiry = (): Date => {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + VERIFICATION_TOKEN_EXPIRY_HOURS);
  return expiry;
};

/**
 * Send a verification email. In development mode (no SMTP configured),
 * logs the verification link to the console.
 *
 * TODO: Wire to production SMTP transport (e.g. nodemailer) when available.
 */
const sendVerificationEmail = (email: string, token: string): void => {
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const verifyUrl = `${baseUrl}/auth/verify-email?token=${token}`;

  // In production, this should send a real email via SMTP.
  // For now, log the link for development/testing.
  console.log(`[EMAIL VERIFICATION] To: ${email}`);
  console.log(`[EMAIL VERIFICATION] Verify your email: ${verifyUrl}`);
};

export const authRouter = new Hono<{ Variables: AuthVariables }>();

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

  // If verification is disabled, mark as verified immediately
  const skipVerification = !isVerificationRequired();
  const verificationToken = skipVerification ? null : generateVerificationToken();
  const verificationExpiry = skipVerification ? null : generateVerificationExpiry();

  const inserted = await db
    .insert(users)
    .values({
      email,
      srpSalt: salt,
      srpVerifier: verifier,
      emailVerified: skipVerification,
      emailVerificationToken: verificationToken,
      emailVerificationExpiry: verificationExpiry,
    })
    .returning({ id: users.id });

  const user = inserted[0];
  if (!user) {
    return c.json({ error: 'REGISTER_FAILED' }, 500);
  }

  // Send verification email if required
  if (verificationToken) {
    sendVerificationEmail(email, verificationToken);
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

    // Fetch email verification status for the client
    const userRows = await db
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, state.userId));
    const emailVerified = userRows[0]?.emailVerified ?? false;

    return c.json(
      {
        sessionToken: session.token,
        serverProof: serverSession.proof,
        emailVerified,
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

// ---------------------------------------------------------------------------
// GET /auth/verify-email?token= — verify email address via token
// ---------------------------------------------------------------------------

authRouter.get('/auth/verify-email', async (c) => {
  const token = c.req.query('token');

  if (!token || typeof token !== 'string' || token.length === 0) {
    return c.json({ error: 'INVALID_TOKEN' }, 400);
  }

  const now = new Date();

  const matchingUsers = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(and(eq(users.emailVerificationToken, token), gt(users.emailVerificationExpiry, now)));

  const user = matchingUsers[0];

  if (!user) {
    return c.json({ error: 'INVALID_OR_EXPIRED_TOKEN' }, 400);
  }

  if (user.emailVerified) {
    return c.json({ message: 'Email already verified' }, 200);
  }

  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
    })
    .where(eq(users.id, user.id));

  return c.json({ message: 'Email verified successfully' }, 200);
});

// ---------------------------------------------------------------------------
// POST /auth/resend-verification — resend verification email (requires auth)
// ---------------------------------------------------------------------------

authRouter.post('/auth/resend-verification', authMiddleware, async (c) => {
  const userId = c.get('userId');

  const userRows = await db
    .select({
      email: users.email,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, userId));

  const user = userRows[0];

  if (!user) {
    return c.json({ error: 'USER_NOT_FOUND' }, 404);
  }

  if (user.emailVerified) {
    return c.json({ message: 'Email already verified' }, 200);
  }

  if (!isVerificationRequired()) {
    // Verification disabled — auto-verify
    await db
      .update(users)
      .set({
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      })
      .where(eq(users.id, userId));
    return c.json({ message: 'Email verified (verification disabled)' }, 200);
  }

  const newToken = generateVerificationToken();
  const newExpiry = generateVerificationExpiry();

  await db
    .update(users)
    .set({
      emailVerificationToken: newToken,
      emailVerificationExpiry: newExpiry,
    })
    .where(eq(users.id, userId));

  sendVerificationEmail(user.email, newToken);

  return c.json({ message: 'Verification email sent' }, 200);
});

// ---------------------------------------------------------------------------
// GET /auth/me — return current user info (requires auth)
// ---------------------------------------------------------------------------

authRouter.get('/auth/me', authMiddleware, async (c) => {
  const userId = c.get('userId');

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      isAdmin: users.isAdmin,
    })
    .from(users)
    .where(eq(users.id, userId));

  const user = userRows[0];

  if (!user) {
    return c.json({ error: 'USER_NOT_FOUND' }, 404);
  }

  return c.json(
    {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      isAdmin: user.isAdmin,
    },
    200,
  );
});
