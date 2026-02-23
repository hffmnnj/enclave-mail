import { describe, expect, test } from 'bun:test';

import {
  deserializePrivateKey,
  deserializePublicKey,
  generateEd25519KeyPair,
  getFingerprint,
  serializePrivateKey,
  serializePublicKey,
  sign,
  verify,
} from './ed25519.js';

describe('ed25519', () => {
  test('generates 32-byte private and public keys', () => {
    const keyPair = generateEd25519KeyPair();

    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toHaveLength(32);
    expect(keyPair.publicKey).toHaveLength(32);
  });

  test('signs and verifies a message', () => {
    const message = new TextEncoder().encode('enclave-mail-signature-test');
    const { privateKey, publicKey } = generateEd25519KeyPair();

    const signature = sign(message, privateKey);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature).toHaveLength(64);
    expect(verify(message, signature, publicKey)).toBe(true);
  });

  test('fails verification for tampered message', () => {
    const originalMessage = new TextEncoder().encode('original-message');
    const tamperedMessage = new TextEncoder().encode('tampered-message');
    const { privateKey, publicKey } = generateEd25519KeyPair();

    const signature = sign(originalMessage, privateKey);

    expect(() => verify(tamperedMessage, signature, publicKey)).not.toThrow();
    expect(verify(tamperedMessage, signature, publicKey)).toBe(false);
  });

  test('fails verification with wrong public key', () => {
    const message = new TextEncoder().encode('wrong-key-check');
    const signer = generateEd25519KeyPair();
    const verifier = generateEd25519KeyPair();

    const signature = sign(message, signer.privateKey);

    expect(verify(message, signature, verifier.publicKey)).toBe(false);
  });

  test('fingerprint is 16 hex characters', () => {
    const { publicKey } = generateEd25519KeyPair();
    const fingerprint = getFingerprint(publicKey);

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  test('fingerprint is deterministic for same key', () => {
    const { publicKey } = generateEd25519KeyPair();

    const fingerprintOne = getFingerprint(publicKey);
    const fingerprintTwo = getFingerprint(publicKey);
    const fingerprintThree = getFingerprint(publicKey);

    expect(fingerprintOne).toBe(fingerprintTwo);
    expect(fingerprintTwo).toBe(fingerprintThree);
  });

  test('different public keys produce different fingerprints', () => {
    const first = generateEd25519KeyPair();
    const second = generateEd25519KeyPair();

    expect(getFingerprint(first.publicKey)).not.toBe(getFingerprint(second.publicKey));
  });

  test('roundtrips public key serialization', () => {
    const { publicKey } = generateEd25519KeyPair();

    const encoded = serializePublicKey(publicKey);
    const decoded = deserializePublicKey(encoded);

    expect(decoded).toEqual(publicKey);
  });

  test('roundtrips private key serialization', () => {
    const { privateKey } = generateEd25519KeyPair();

    const encoded = serializePrivateKey(privateKey);
    const decoded = deserializePrivateKey(encoded);

    expect(decoded).toEqual(privateKey);
  });
});
