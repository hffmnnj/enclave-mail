import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEV_FALLBACK_KEY_SEED = 'enclave-mail-dev-mime-encryption-key-v1';

let hasWarnedAboutFallback = false;

/**
 * MIME_ENCRYPTION_KEY must be a 64-char hex string (32 bytes) in production.
 * In non-production environments, a deterministic fallback key is used when
 * missing/invalid to keep local development and tests working.
 */
const getMimeEncryptionKey = (): Buffer => {
  const keyHex = process.env.MIME_ENCRYPTION_KEY?.trim();
  const isValidHexKey = Boolean(keyHex && /^[0-9a-fA-F]{64}$/.test(keyHex));

  if (isValidHexKey && keyHex) {
    return Buffer.from(keyHex, 'hex');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'MIME_ENCRYPTION_KEY is required in production and must be 64 hex chars (32 bytes).',
    );
  }

  if (!hasWarnedAboutFallback) {
    console.warn(
      '[mime-encryption] MIME_ENCRYPTION_KEY is missing or invalid; using deterministic dev fallback key. Set MIME_ENCRYPTION_KEY (64 hex chars) for production-like security.',
    );
    hasWarnedAboutFallback = true;
  }

  return createHash('sha256').update(DEV_FALLBACK_KEY_SEED).digest();
};

export const encryptMimeBody = (
  mimeBody: string,
): { encryptedMimeBody: string; mimeBodyNonce: string } => {
  const key = getMimeEncryptionKey();
  if (key.length !== KEY_LENGTH) {
    throw new Error('MIME encryption key must be 32 bytes.');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(mimeBody, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, authTag]);

  return {
    encryptedMimeBody: combined.toString('base64'),
    mimeBodyNonce: iv.toString('base64'),
  };
};

export const decryptMimeBody = (encryptedMimeBody: string, mimeBodyNonce: string): string => {
  const key = getMimeEncryptionKey();
  if (key.length !== KEY_LENGTH) {
    throw new Error('MIME encryption key must be 32 bytes.');
  }

  const iv = Buffer.from(mimeBodyNonce, 'base64');
  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid MIME body nonce.');
  }

  const combined = Buffer.from(encryptedMimeBody, 'base64');
  if (combined.length <= AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted MIME body payload.');
  }

  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};
