import { describe, expect, test } from 'bun:test';

import { generateEd25519KeyPair } from './ed25519.js';
import type { Argon2idParams } from './key-derivation.js';
import {
  type KeyBundle,
  exportKeyBundle,
  importKeyBundle,
  validateKeyBundle,
} from './key-export.js';
import { generateX25519KeyPair } from './x25519.js';

const TEST_PARAMS: Argon2idParams = {
  memory: 4096,
  iterations: 1,
  parallelism: 1,
};

const TEST_PASSPHRASE = 'correct horse battery staple';

const makeKeyPairs = () => ({
  x25519: generateX25519KeyPair(),
  ed25519: generateEd25519KeyPair(),
});

describe('key-export', () => {
  test('exportKeyBundle returns valid JSON string', async () => {
    const keypairs = makeKeyPairs();

    const json = await exportKeyBundle(keypairs, TEST_PASSPHRASE, TEST_PARAMS);
    const parsed = JSON.parse(json) as KeyBundle;

    expect(typeof json).toBe('string');
    expect(parsed.version).toBe(1);
    expect(parsed.x25519_public).toEqual(expect.any(String));
    expect(parsed.x25519_private_encrypted).toEqual(expect.any(String));
    expect(parsed.ed25519_public).toEqual(expect.any(String));
    expect(parsed.ed25519_private_encrypted).toEqual(expect.any(String));
    expect(parsed.salt).toEqual(expect.any(String));
    expect(parsed.created_at).toEqual(expect.any(String));
  });

  test('exportKeyBundle and importKeyBundle roundtrip keys', async () => {
    const original = makeKeyPairs();

    const json = await exportKeyBundle(original, TEST_PASSPHRASE, TEST_PARAMS);
    const imported = await importKeyBundle(json, TEST_PASSPHRASE, TEST_PARAMS);

    expect(imported.x25519.privateKey).toEqual(original.x25519.privateKey);
    expect(imported.x25519.publicKey).toEqual(original.x25519.publicKey);
    expect(imported.ed25519.privateKey).toEqual(original.ed25519.privateKey);
    expect(imported.ed25519.publicKey).toEqual(original.ed25519.publicKey);
  });

  test('importKeyBundle throws with wrong passphrase', async () => {
    const keypairs = makeKeyPairs();
    const json = await exportKeyBundle(keypairs, TEST_PASSPHRASE, TEST_PARAMS);

    await expect(importKeyBundle(json, 'wrong passphrase', TEST_PARAMS)).rejects.toThrow();
  });

  test('validateKeyBundle returns true for valid bundle JSON', async () => {
    const keypairs = makeKeyPairs();
    const json = await exportKeyBundle(keypairs, TEST_PASSPHRASE, TEST_PARAMS);

    expect(validateKeyBundle(json)).toBe(true);
  });

  test('validateKeyBundle returns false for invalid JSON', () => {
    expect(validateKeyBundle('not valid json')).toBe(false);
  });

  test('validateKeyBundle returns false when required fields are missing', () => {
    const incomplete = JSON.stringify({
      version: 1,
      x25519_public: 'x',
      x25519_private_encrypted: 'x',
      ed25519_public: 'x',
      ed25519_private_encrypted: 'x',
      salt: 'x',
    });

    expect(validateKeyBundle(incomplete)).toBe(false);
  });

  test('validateKeyBundle returns false for wrong version', () => {
    const wrongVersion = JSON.stringify({
      version: 2,
      x25519_public: 'x',
      x25519_private_encrypted: 'x',
      ed25519_public: 'x',
      ed25519_private_encrypted: 'x',
      salt: 'x',
      created_at: new Date().toISOString(),
    });

    expect(validateKeyBundle(wrongVersion)).toBe(false);
  });

  test('importKeyBundle throws on corrupted encrypted data', async () => {
    const keypairs = makeKeyPairs();
    const exported = await exportKeyBundle(keypairs, TEST_PASSPHRASE, TEST_PARAMS);
    const bundle = JSON.parse(exported) as KeyBundle;
    const chars = bundle.x25519_private_encrypted.split('');
    const tamperIndex = chars.length - 2;

    if (tamperIndex < 0) {
      throw new Error('Encrypted payload is unexpectedly short');
    }

    const originalChar = chars[tamperIndex];

    if (originalChar === undefined) {
      throw new Error('Unable to read tamper target character');
    }

    chars[tamperIndex] = originalChar === 'A' ? 'B' : 'A';
    bundle.x25519_private_encrypted = chars.join('');

    await expect(
      importKeyBundle(JSON.stringify(bundle), TEST_PASSPHRASE, TEST_PARAMS),
    ).rejects.toThrow();
  });
});
