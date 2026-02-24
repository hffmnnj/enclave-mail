import { beforeAll, describe, expect, test } from 'bun:test';

import { decryptPrivateKey } from './encrypted-key-store.js';
import { deriveKey } from './key-derivation.js';
import { importKeyBundle, validateKeyBundle } from './key-export.js';
import { generateRegistrationBundle } from './registration.js';

const TEST_EMAIL = 'alice@example.com';
const TEST_PASSPHRASE = 'strongPassphrase123!';
const KEY_DERIVATION_SALT_LENGTH = 16;

const HEX_PATTERN = /^[0-9a-f]+$/;

const fromHex = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have an even length');
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    const offset = index * 2;
    const chunk = hex.slice(offset, offset + 2);
    const parsed = Number.parseInt(chunk, 16);

    if (Number.isNaN(parsed)) {
      throw new Error('Invalid hex value');
    }

    bytes[index] = parsed;
  }

  return bytes;
};

const splitEncryptedBlob = (
  encryptedHex: string,
): { salt: Uint8Array; encryptedBlob: Uint8Array } => {
  const bytes = fromHex(encryptedHex);
  const salt = bytes.slice(0, KEY_DERIVATION_SALT_LENGTH);
  const encryptedBlob = bytes.slice(KEY_DERIVATION_SALT_LENGTH);

  return { salt, encryptedBlob };
};

describe('registration', () => {
  let registrationBundle: Awaited<ReturnType<typeof generateRegistrationBundle>>;

  beforeAll(async () => {
    registrationBundle = await generateRegistrationBundle(TEST_EMAIL, TEST_PASSPHRASE);
  });

  test('generateRegistrationBundle returns all expected fields', () => {
    expect(registrationBundle.salt).toEqual(expect.any(String));
    expect(registrationBundle.verifier).toEqual(expect.any(String));

    expect(registrationBundle.x25519KeyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(registrationBundle.x25519KeyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(registrationBundle.ed25519KeyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(registrationBundle.ed25519KeyPair.publicKey).toBeInstanceOf(Uint8Array);

    expect(registrationBundle.x25519PublicHex).toEqual(expect.any(String));
    expect(registrationBundle.ed25519PublicHex).toEqual(expect.any(String));
    expect(registrationBundle.encryptedX25519PrivateHex).toEqual(expect.any(String));
    expect(registrationBundle.encryptedEd25519PrivateHex).toEqual(expect.any(String));
    expect(registrationBundle.keyExportBundle).toEqual(expect.any(String));
  });

  test('SRP verifier is non-empty and never equals passphrase', () => {
    expect(registrationBundle.verifier.length).toBeGreaterThan(0);
    expect(registrationBundle.verifier).not.toBe(TEST_PASSPHRASE);
  });

  test('encrypted X25519 private key decrypts with derived key from passphrase', async () => {
    const { salt, encryptedBlob } = splitEncryptedBlob(
      registrationBundle.encryptedX25519PrivateHex,
    );
    const derivedKey = await deriveKey(TEST_PASSPHRASE, salt);
    const decryptedPrivateKey = decryptPrivateKey(encryptedBlob, derivedKey);

    expect(decryptedPrivateKey).toEqual(registrationBundle.x25519KeyPair.privateKey);
  });

  test('encrypted Ed25519 private key decrypts with derived key from passphrase', async () => {
    const { salt, encryptedBlob } = splitEncryptedBlob(
      registrationBundle.encryptedEd25519PrivateHex,
    );
    const derivedKey = await deriveKey(TEST_PASSPHRASE, salt);
    const decryptedPrivateKey = decryptPrivateKey(encryptedBlob, derivedKey);

    expect(decryptedPrivateKey).toEqual(registrationBundle.ed25519KeyPair.privateKey);
  });

  test('key export bundle validates as proper bundle JSON', () => {
    expect(validateKeyBundle(registrationBundle.keyExportBundle)).toBe(true);
  });

  test('key export bundle imports original keys with passphrase', async () => {
    const importedBundle = await importKeyBundle(
      registrationBundle.keyExportBundle,
      TEST_PASSPHRASE,
    );

    expect(importedBundle.x25519.privateKey).toEqual(registrationBundle.x25519KeyPair.privateKey);
    expect(importedBundle.x25519.publicKey).toEqual(registrationBundle.x25519KeyPair.publicKey);
    expect(importedBundle.ed25519.privateKey).toEqual(registrationBundle.ed25519KeyPair.privateKey);
    expect(importedBundle.ed25519.publicKey).toEqual(registrationBundle.ed25519KeyPair.publicKey);
  });

  test('same credentials still produce different encrypted private key blobs', async () => {
    const secondBundle = await generateRegistrationBundle(TEST_EMAIL, TEST_PASSPHRASE);

    expect(secondBundle.encryptedX25519PrivateHex).not.toBe(
      registrationBundle.encryptedX25519PrivateHex,
    );
    expect(secondBundle.encryptedEd25519PrivateHex).not.toBe(
      registrationBundle.encryptedEd25519PrivateHex,
    );
  });

  test('hex fields are valid lowercase hex strings with even length', () => {
    const hexFields = [
      registrationBundle.x25519PublicHex,
      registrationBundle.ed25519PublicHex,
      registrationBundle.encryptedX25519PrivateHex,
      registrationBundle.encryptedEd25519PrivateHex,
    ];

    for (const field of hexFields) {
      expect(field.length % 2).toBe(0);
      expect(HEX_PATTERN.test(field)).toBe(true);
    }
  });
});
