import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';

import { type Argon2idParams, deriveKey, generateSalt } from './key-derivation.js';

const DERIVED_KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const assertDerivedKeyLength = (derivedKey: Uint8Array): void => {
  if (derivedKey.length !== DERIVED_KEY_LENGTH) {
    throw new Error(`Derived key must be ${DERIVED_KEY_LENGTH} bytes`);
  }
};

const assertSaltLength = (salt: Uint8Array): void => {
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Salt must be ${SALT_LENGTH} bytes`);
  }
};

const assertEncryptedBlobLength = (encryptedBlob: Uint8Array): void => {
  const minimumEncryptedBlobLength = NONCE_LENGTH + AUTH_TAG_LENGTH;

  if (encryptedBlob.length < minimumEncryptedBlobLength) {
    throw new Error(
      `Encrypted blob must be at least ${minimumEncryptedBlobLength} bytes (nonce + tag)`,
    );
  }
};

const assertPassphraseEncryptedBlobLength = (encryptedBlob: Uint8Array): void => {
  const minimumPassphraseBlobLength = SALT_LENGTH + NONCE_LENGTH + AUTH_TAG_LENGTH;

  if (encryptedBlob.length < minimumPassphraseBlobLength) {
    throw new Error(
      `Encrypted blob must be at least ${minimumPassphraseBlobLength} bytes (salt + nonce + tag)`,
    );
  }
};

export const encryptPrivateKey = (privateKey: Uint8Array, derivedKey: Uint8Array): Uint8Array => {
  assertDerivedKeyLength(derivedKey);

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = chacha20poly1305(derivedKey, nonce);
  const ciphertextWithTag = cipher.encrypt(privateKey);

  return new Uint8Array([...nonce, ...ciphertextWithTag]);
};

export const decryptPrivateKey = (
  encryptedBlob: Uint8Array,
  derivedKey: Uint8Array,
): Uint8Array => {
  assertDerivedKeyLength(derivedKey);
  assertEncryptedBlobLength(encryptedBlob);

  const nonce = encryptedBlob.slice(0, NONCE_LENGTH);
  const ciphertextWithTag = encryptedBlob.slice(NONCE_LENGTH);
  const cipher = chacha20poly1305(derivedKey, nonce);

  return cipher.decrypt(ciphertextWithTag);
};

export const encryptPrivateKeyWithPassphrase = async (
  privateKey: Uint8Array,
  passphrase: string,
  existingSalt?: Uint8Array,
  params?: Argon2idParams,
): Promise<Uint8Array> => {
  const salt = existingSalt ?? generateSalt();
  assertSaltLength(salt);

  const derivedKey = await deriveKey(passphrase, salt, params);
  const encryptedBlob = encryptPrivateKey(privateKey, derivedKey);

  return new Uint8Array([...salt, ...encryptedBlob]);
};

export const decryptPrivateKeyWithPassphrase = async (
  encryptedBlob: Uint8Array,
  passphrase: string,
  params?: Argon2idParams,
): Promise<Uint8Array> => {
  assertPassphraseEncryptedBlobLength(encryptedBlob);

  const salt = encryptedBlob.slice(0, SALT_LENGTH);
  const encryptedPrivateKey = encryptedBlob.slice(SALT_LENGTH);
  const derivedKey = await deriveKey(passphrase, salt, params);

  return decryptPrivateKey(encryptedPrivateKey, derivedKey);
};
