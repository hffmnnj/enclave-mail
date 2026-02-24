import crypto from 'node:crypto';
import { createDbClient } from './client.js';
import { keypairs } from './schema/keypairs.js';
import { type mailboxTypeEnum, mailboxes } from './schema/mailboxes.js';
import { users } from './schema/users.js';

const DEFAULT_MAILBOXES: ReadonlyArray<{
  name: string;
  type: (typeof mailboxTypeEnum.enumValues)[number];
}> = [
  { name: 'INBOX', type: 'inbox' },
  { name: 'Sent', type: 'sent' },
  { name: 'Drafts', type: 'drafts' },
  { name: 'Trash', type: 'trash' },
  { name: 'Archive', type: 'archive' },
] as const;

const generateUidValidity = (): number => {
  return crypto.randomInt(1, 2_147_483_647);
};

const seed = async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[seed] DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const db = createDbClient(connectionString);

  console.log('[seed] Seeding database...');

  // 1. Create test user with placeholder SRP values
  console.log('[seed] Creating test user...');
  const [testUser] = await db
    .insert(users)
    .values({
      email: 'test@enclave.local',
      srpSalt: new Uint8Array(crypto.randomBytes(16)),
      srpVerifier: new Uint8Array(crypto.randomBytes(32)),
      keyExportConfirmed: false,
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, email: users.email });

  if (!testUser) {
    console.log('[seed] Test user already exists, fetching...');
    const { eq } = await import('drizzle-orm');
    const existingUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, 'test@enclave.local'));
    const existing = existingUsers[0];
    if (!existing) {
      console.error('[seed] Failed to find or create test user.');
      process.exit(1);
    }
    await seedKeypairs(db, existing.id);
    await seedMailboxes(db, existing.id);
  } else {
    console.log(`[seed] Created test user: ${testUser.email} (${testUser.id})`);
    await seedKeypairs(db, testUser.id);
    await seedMailboxes(db, testUser.id);
  }

  console.log('[seed] Seeding complete.');
  process.exit(0);
};

const seedKeypairs = async (db: ReturnType<typeof createDbClient>, userId: string) => {
  console.log('[seed] Creating stub keypairs...');

  // X25519 keypair (placeholder random bytes)
  await db
    .insert(keypairs)
    .values({
      userId,
      type: 'x25519',
      publicKey: new Uint8Array(crypto.randomBytes(32)),
      encryptedPrivateKey: new Uint8Array(crypto.randomBytes(32)),
      isActive: true,
    })
    .onConflictDoNothing();

  // Ed25519 keypair (placeholder random bytes)
  await db
    .insert(keypairs)
    .values({
      userId,
      type: 'ed25519',
      publicKey: new Uint8Array(crypto.randomBytes(32)),
      encryptedPrivateKey: new Uint8Array(crypto.randomBytes(32)),
      isActive: true,
    })
    .onConflictDoNothing();

  console.log('[seed] Stub keypairs created (x25519 + ed25519).');
};

const seedMailboxes = async (db: ReturnType<typeof createDbClient>, userId: string) => {
  console.log('[seed] Creating default mailboxes...');

  for (const mailbox of DEFAULT_MAILBOXES) {
    await db
      .insert(mailboxes)
      .values({
        userId,
        name: mailbox.name,
        type: mailbox.type,
        uidValidity: generateUidValidity(),
      })
      .onConflictDoNothing();
  }

  console.log(`[seed] Created ${DEFAULT_MAILBOXES.length} default mailboxes.`);
};

seed().catch((error: unknown) => {
  console.error('[seed] Seed failed:', error);
  process.exit(1);
});
