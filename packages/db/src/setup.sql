-- Enclave Mail — database setup
-- Generated from Drizzle schema (applied directly to bypass drizzle-kit CJS issue)

-- Enums
DO $$ BEGIN
  CREATE TYPE keypair_type AS ENUM ('x25519', 'ed25519');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mailbox_type AS ENUM ('inbox', 'sent', 'drafts', 'trash', 'archive', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_flag AS ENUM ('seen', 'flagged', 'deleted', 'draft', 'answered');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE prekey_type AS ENUM ('signed', 'one_time');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- users
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  srp_salt    BYTEA NOT NULL,
  srp_verifier BYTEA NOT NULL,
  key_export_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email verification columns (added for abuse prevention)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Ensure every user has an Archive mailbox (idempotent backfill for existing users)
INSERT INTO mailboxes (user_id, name, type, uid_validity, uid_next)
SELECT u.id, 'Archive', 'archive', EXTRACT(EPOCH FROM NOW())::INTEGER, 1
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM mailboxes m WHERE m.user_id = u.id AND m.type = 'archive'
);

-- keypairs
CREATE TABLE IF NOT EXISTS keypairs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                 keypair_type NOT NULL,
  public_key           BYTEA NOT NULL,
  encrypted_private_key BYTEA NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keypairs_user_type_active_idx ON keypairs (user_id, type, is_active);

-- sessions
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_expires_idx ON sessions (user_id, expires_at);

-- mailboxes
CREATE TABLE IF NOT EXISTS mailboxes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          mailbox_type NOT NULL,
  uid_validity  INTEGER NOT NULL,
  uid_next      INTEGER NOT NULL DEFAULT 1,
  message_count INTEGER NOT NULL DEFAULT 0,
  unread_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_user_name_idx ON mailboxes (user_id, name);
CREATE INDEX IF NOT EXISTS mailboxes_user_idx ON mailboxes (user_id);

-- messages
CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id        UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  uid               INTEGER NOT NULL,
  message_id        TEXT,
  in_reply_to       TEXT,
  from_address      TEXT NOT NULL,
  to_addresses      JSONB NOT NULL,
  subject_encrypted BYTEA,
  date              TIMESTAMPTZ NOT NULL,
  flags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  size              INTEGER NOT NULL DEFAULT 0,
  dkim_status       TEXT,
  spf_status        TEXT,
  dmarc_status      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_mailbox_uid_unique_idx ON messages (mailbox_id, uid);
CREATE INDEX IF NOT EXISTS messages_mailbox_idx ON messages (mailbox_id);
CREATE INDEX IF NOT EXISTS messages_mailbox_uid_idx ON messages (mailbox_id, uid);
CREATE INDEX IF NOT EXISTS messages_mailbox_date_desc_idx ON messages (mailbox_id, date DESC);
CREATE INDEX IF NOT EXISTS messages_message_id_idx ON messages (message_id);

-- message_bodies
CREATE TABLE IF NOT EXISTS message_bodies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id          UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  encrypted_body      BYTEA NOT NULL,
  content_type        TEXT NOT NULL DEFAULT 'text/plain',
  encryption_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS message_bodies_message_id_unique_idx ON message_bodies (message_id);

-- prekeys
CREATE TABLE IF NOT EXISTS prekeys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id     INTEGER NOT NULL,
  public_key BYTEA NOT NULL,
  signature  BYTEA,
  key_type   prekey_type NOT NULL,
  is_used    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS prekeys_user_type_used_created_idx ON prekeys (user_id, key_type, is_used, created_at);

-- attachment_blobs
CREATE TABLE IF NOT EXISTS attachment_blobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
  encrypted_blob  BYTEA NOT NULL,
  size            INTEGER NOT NULL,
  nonce           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS attachment_blobs_message_id_idx ON attachment_blobs (message_id);

-- push_subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- system_config
CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
