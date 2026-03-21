import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const NONCE_LENGTH = 12;
const X25519_KEY_LENGTH = 32;
const CHACHA_KEY_LENGTH = 32;
const ARGON2_SALT_LENGTH = 16;
const HKDF_INFO = new TextEncoder().encode('enclave-inbound-v1');
const SESSION_KEY_INFO = new TextEncoder().encode('enclave-session-key');
const EMPTY_SALT = new Uint8Array(0);

type SessionKeyMetadata = {
  algorithm: 'chacha20-poly1305';
  version?: number;
};

type X25519Metadata = {
  algorithm: 'x25519-chacha20poly1305';
  ephemeralPublicKey: string;
  bodyNonce: string;
  subjectNonce: string;
  salt?: string;
};

type EncryptionMetadata = SessionKeyMetadata | X25519Metadata;

type KeyMaterial = {
  sessionKey?: Uint8Array;
  privateKey?: Uint8Array;
  x25519PrivateKey?: Uint8Array;
};

const isHex = (value: string): boolean => /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;

const decodeHex = (hex: string): Uint8Array => {
  const output = new Uint8Array(hex.length / 2);
  for (let i = 0; i < output.length; i++) {
    const start = i * 2;
    output[i] = Number.parseInt(hex.slice(start, start + 2), 16);
  }
  return output;
};

const normalizeBase64 = (base64: string): string => {
  const standard = base64.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (standard.length % 4)) % 4;
  return standard + '='.repeat(paddingLength);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const normalized = normalizeBase64(base64);
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
};

const bytesToString = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const parseMetadataBytes = (encoded: string): Uint8Array => {
  if (isHex(encoded)) {
    return decodeHex(encoded);
  }
  return base64ToBytes(encoded);
};

const normalizeArgon2Salt = (salt: Uint8Array): Uint8Array => {
  if (salt.length === ARGON2_SALT_LENGTH) {
    return salt;
  }

  if (salt.length > ARGON2_SALT_LENGTH) {
    return salt.slice(0, ARGON2_SALT_LENGTH);
  }

  const padded = new Uint8Array(ARGON2_SALT_LENGTH);
  padded.set(salt);
  return padded;
};

const isValidLength = (value: Uint8Array, expected: number): boolean => value.length === expected;

const decryptWithSessionKey = (
  base64Encrypted: string,
  sessionKey: Uint8Array,
): string | undefined => {
  try {
    if (!isValidLength(sessionKey, CHACHA_KEY_LENGTH)) {
      return undefined;
    }

    const payload = base64ToBytes(base64Encrypted);
    if (payload.length <= NONCE_LENGTH) {
      return undefined;
    }

    const nonce = payload.slice(0, NONCE_LENGTH);
    const ciphertext = payload.slice(NONCE_LENGTH);

    const cipher = chacha20poly1305(sessionKey, nonce);
    const plaintext = cipher.decrypt(ciphertext);
    return bytesToString(plaintext);
  } catch {
    return undefined;
  }
};

const decryptWithNonce = (
  base64Encrypted: string,
  symmetricKey: Uint8Array,
  nonce: Uint8Array,
): string | undefined => {
  try {
    if (!isValidLength(nonce, NONCE_LENGTH) || !isValidLength(symmetricKey, CHACHA_KEY_LENGTH)) {
      return undefined;
    }

    const ciphertext = base64ToBytes(base64Encrypted);
    const cipher = chacha20poly1305(symmetricKey, nonce);
    const plaintext = cipher.decrypt(ciphertext);
    return bytesToString(plaintext);
  } catch {
    return undefined;
  }
};

const decryptWithX25519 = (
  base64Encrypted: string,
  encryptionMetadata: X25519Metadata,
  privateKey: Uint8Array,
): string | undefined => {
  try {
    if (!isValidLength(privateKey, X25519_KEY_LENGTH)) {
      return undefined;
    }

    const ephemeralPublicKey = parseMetadataBytes(encryptionMetadata.ephemeralPublicKey);
    if (!isValidLength(ephemeralPublicKey, X25519_KEY_LENGTH)) {
      return undefined;
    }

    const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);
    const salt = encryptionMetadata.salt
      ? new TextEncoder().encode(encryptionMetadata.salt)
      : EMPTY_SALT;
    const symmetricKey = hkdf(sha256, sharedSecret, salt, HKDF_INFO, CHACHA_KEY_LENGTH);

    const bodyNonce = parseMetadataBytes(encryptionMetadata.bodyNonce);
    const bodyResult = decryptWithNonce(base64Encrypted, symmetricKey, bodyNonce);
    if (bodyResult !== undefined) {
      return bodyResult;
    }

    const subjectNonce = parseMetadataBytes(encryptionMetadata.subjectNonce);
    return decryptWithNonce(base64Encrypted, symmetricKey, subjectNonce);
  } catch {
    return undefined;
  }
};

const resolveX25519PrivateKey = (keyMaterial: KeyMaterial): Uint8Array | undefined => {
  if (keyMaterial.privateKey instanceof Uint8Array) {
    return keyMaterial.privateKey;
  }
  if (keyMaterial.x25519PrivateKey instanceof Uint8Array) {
    return keyMaterial.x25519PrivateKey;
  }
  return undefined;
};

const deriveSessionKeyFromPassphrase = async (
  passphrase: string,
  salt: string | Uint8Array,
): Promise<Uint8Array> => {
  const saltBytes = typeof salt === 'string' ? parseMetadataBytes(salt) : salt;
  const normalizedSalt = normalizeArgon2Salt(saltBytes);

  const { deriveKey } = await import('@enclave/crypto');
  const masterKey = await deriveKey(passphrase, normalizedSalt);

  return hkdf(sha256, masterKey, EMPTY_SALT, SESSION_KEY_INFO, CHACHA_KEY_LENGTH);
};

const decryptX25519PrivateKeyFromExportBlob = async (
  encryptedBlobBase64: string,
  passphrase: string,
): Promise<Uint8Array> => {
  const { decryptPrivateKeyWithPassphrase } = await import('@enclave/crypto');
  return decryptPrivateKeyWithPassphrase(base64ToBytes(encryptedBlobBase64), passphrase);
};

const clearInMemorySessionSecrets = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  Reflect.set(window, '__enclave_session_key', undefined);
  Reflect.set(window, '__enclave_x25519_private_key', undefined);
};

declare global {
  interface Window {
    __enclave_session_key?: Uint8Array | undefined;
    __enclave_x25519_private_key?: Uint8Array | undefined;
  }
}

const decryptField = (
  base64Encrypted: string,
  encryptionMetadata: EncryptionMetadata,
  keyMaterial: KeyMaterial,
): string | undefined => {
  try {
    if (encryptionMetadata.algorithm === 'chacha20-poly1305') {
      if (!(keyMaterial.sessionKey instanceof Uint8Array)) {
        return undefined;
      }
      return decryptWithSessionKey(base64Encrypted, keyMaterial.sessionKey);
    }

    if (encryptionMetadata.algorithm === 'x25519-chacha20poly1305') {
      const privateKey = resolveX25519PrivateKey(keyMaterial);
      if (!privateKey) {
        return undefined;
      }
      return decryptWithX25519(base64Encrypted, encryptionMetadata, privateKey);
    }

    return undefined;
  } catch {
    return undefined;
  }
};

export {
  base64ToBytes,
  bytesToString,
  deriveSessionKeyFromPassphrase,
  decryptX25519PrivateKeyFromExportBlob,
  decryptWithSessionKey,
  decryptWithX25519,
  decryptField,
  clearInMemorySessionSecrets,
};

export type { EncryptionMetadata, X25519Metadata, KeyMaterial };
