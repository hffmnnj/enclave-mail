import { describe, expect, test } from 'bun:test';

import {
  decryptPrivateKey,
  decryptPrivateKeyWithPassphrase,
  encryptPrivateKey,
  encryptPrivateKeyWithPassphrase,
} from './encrypted-key-store.js';
import { type Argon2idParams, deriveKey, generateSalt } from './key-derivation.js';

const TEST_PARAMS: Argon2idParams = {
  memory: 4096,
  iterations: 1,
  parallelism: 1,
};

const TEST_PASSPHRASE = 'correct horse battery staple';

describe('key-derivation + encrypted-key-store', () => {
  test('deriveKey produces a 32-byte output', async () => {
    const salt = generateSalt();

    const derivedKey = await deriveKey(TEST_PASSPHRASE, salt, TEST_PARAMS);

    expect(derivedKey).toBeInstanceOf(Uint8Array);
    expect(derivedKey).toHaveLength(32);
  });

  test('deriveKey is deterministic for identical input', async () => {
    const salt = generateSalt();

    const first = await deriveKey(TEST_PASSPHRASE, salt, TEST_PARAMS);
    const second = await deriveKey(TEST_PASSPHRASE, salt, TEST_PARAMS);

    expect(first).toEqual(second);
  });

  test('deriveKey changes when salt changes', async () => {
    const saltOne = generateSalt();
    const saltTwo = generateSalt();

    const first = await deriveKey(TEST_PASSPHRASE, saltOne, TEST_PARAMS);
    const second = await deriveKey(TEST_PASSPHRASE, saltTwo, TEST_PARAMS);

    expect(first).not.toEqual(second);
  });

  test('deriveKey changes when passphrase changes', async () => {
    const salt = generateSalt();

    const first = await deriveKey(TEST_PASSPHRASE, salt, TEST_PARAMS);
    const second = await deriveKey('tr0ub4dor&3', salt, TEST_PARAMS);

    expect(first).not.toEqual(second);
  });

  test('encryptPrivateKey and decryptPrivateKey roundtrip', async () => {
    const privateKey = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
    const salt = generateSalt();
    const derivedKey = await deriveKey(TEST_PASSPHRASE, salt, TEST_PARAMS);

    const encryptedBlob = encryptPrivateKey(privateKey, derivedKey);
    const decryptedPrivateKey = decryptPrivateKey(encryptedBlob, derivedKey);

    expect(decryptedPrivateKey).toEqual(privateKey);
  });

  test('decryptPrivateKey throws when ciphertext tag is tampered', async () => {
    const privateKey = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
    const salt = generateSalt();
    const derivedKey = await deriveKey(TEST_PASSPHRASE, salt, TEST_PARAMS);
    const encryptedBlob = encryptPrivateKey(privateKey, derivedKey);
    const tamperedBlob = new Uint8Array(encryptedBlob);
    const lastIndex = tamperedBlob.length - 1;
    const lastByte = tamperedBlob[lastIndex];

    if (lastByte === undefined) {
      throw new Error('Encrypted blob is unexpectedly empty');
    }

    tamperedBlob[lastIndex] = lastByte ^ 0xff;

    expect(() => decryptPrivateKey(tamperedBlob, derivedKey)).toThrow();
  });

  test('encryptPrivateKeyWithPassphrase and decryptPrivateKeyWithPassphrase roundtrip', async () => {
    const privateKey = new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index));

    const encryptedBlob = await encryptPrivateKeyWithPassphrase(
      privateKey,
      TEST_PASSPHRASE,
      undefined,
      TEST_PARAMS,
    );
    const decryptedPrivateKey = await decryptPrivateKeyWithPassphrase(
      encryptedBlob,
      TEST_PASSPHRASE,
      TEST_PARAMS,
    );

    expect(decryptedPrivateKey).toEqual(privateKey);
  });

  test('decryptPrivateKeyWithPassphrase throws on wrong passphrase', async () => {
    const privateKey = new Uint8Array(Array.from({ length: 32 }, (_, index) => index));

    const encryptedBlob = await encryptPrivateKeyWithPassphrase(
      privateKey,
      TEST_PASSPHRASE,
      undefined,
      TEST_PARAMS,
    );

    await expect(
      decryptPrivateKeyWithPassphrase(encryptedBlob, 'wrong passphrase', TEST_PARAMS),
    ).rejects.toThrow();
  });
});
