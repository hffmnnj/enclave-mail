import { describe, expect, test } from 'bun:test';

import {
  computeSharedSecret,
  deserializePrivateKey,
  deserializePublicKey,
  generateX25519KeyPair,
  serializePrivateKey,
  serializePublicKey,
} from './x25519.js';

describe('x25519', () => {
  test('generates 32-byte private and public keys', () => {
    const keyPair = generateX25519KeyPair();

    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toHaveLength(32);
    expect(keyPair.publicKey).toHaveLength(32);
  });

  test('derives identical shared secret for both parties', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();

    const aliceSecret = computeSharedSecret(alice.privateKey, bob.publicKey);
    const bobSecret = computeSharedSecret(bob.privateKey, alice.publicKey);

    expect(aliceSecret).toEqual(bobSecret);
    expect(aliceSecret).toHaveLength(32);
  });

  test('roundtrips public key serialization', () => {
    const { publicKey } = generateX25519KeyPair();

    const encoded = serializePublicKey(publicKey);
    const decoded = deserializePublicKey(encoded);

    expect(decoded).toEqual(publicKey);
  });

  test('roundtrips private key serialization', () => {
    const { privateKey } = generateX25519KeyPair();

    const encoded = serializePrivateKey(privateKey);
    const decoded = deserializePrivateKey(encoded);

    expect(decoded).toEqual(privateKey);
  });

  test('different keypairs derive different shared secrets', () => {
    const alice = generateX25519KeyPair();
    const bobOne = generateX25519KeyPair();
    const bobTwo = generateX25519KeyPair();

    const secretOne = computeSharedSecret(alice.privateKey, bobOne.publicKey);
    const secretTwo = computeSharedSecret(alice.privateKey, bobTwo.publicKey);

    expect(secretOne).not.toEqual(secretTwo);
  });

  test('throws on wrong-length private key', () => {
    const { publicKey } = generateX25519KeyPair();
    const corruptedPrivateKey = new Uint8Array(31);

    expect(() => computeSharedSecret(corruptedPrivateKey, publicKey)).toThrow(
      'X25519 private key must be 32 bytes',
    );
  });
});
