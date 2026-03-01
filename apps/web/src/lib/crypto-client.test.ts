/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  type EncryptionMetadata,
  type X25519Metadata,
  decryptField,
  decryptWithSessionKey,
  decryptWithX25519,
} from './crypto-client.js';

const HKDF_INFO = new TextEncoder().encode('enclave-inbound-v1');
const textEncoder = new TextEncoder();

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
};

describe('decryptWithSessionKey', () => {
  test('decrypts a valid chacha20-poly1305 payload', () => {
    const sessionKey = new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29, 30, 31, 32,
    ]);
    const nonce = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 123, 135]);
    const plaintext = 'session-key vector: encrypted subject';

    const cipher = chacha20poly1305(sessionKey, nonce);
    const encrypted = cipher.encrypt(textEncoder.encode(plaintext));
    const payload = new Uint8Array(nonce.length + encrypted.length);
    payload.set(nonce, 0);
    payload.set(encrypted, nonce.length);

    expect(decryptWithSessionKey(bytesToBase64(payload), sessionKey)).toBe(plaintext);
  });

  test('returns undefined with wrong key', () => {
    const sessionKey = new Uint8Array(32).fill(9);
    const wrongKey = new Uint8Array(32).fill(8);
    const nonce = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

    const cipher = chacha20poly1305(sessionKey, nonce);
    const encrypted = cipher.encrypt(textEncoder.encode('hello'));
    const payload = new Uint8Array(nonce.length + encrypted.length);
    payload.set(nonce, 0);
    payload.set(encrypted, nonce.length);

    expect(decryptWithSessionKey(bytesToBase64(payload), wrongKey)).toBeUndefined();
  });

  test('returns undefined with corrupted payload', () => {
    const sessionKey = new Uint8Array(32).fill(3);
    expect(decryptWithSessionKey('%%%not-valid-base64%%%', sessionKey)).toBeUndefined();
  });
});

describe('decryptWithX25519', () => {
  const recipientPrivateKey = new Uint8Array([
    0x88, 0x5a, 0x2e, 0x9a, 0x71, 0xf0, 0x1b, 0xc3, 0x10, 0x54, 0x8f, 0xd2, 0x49, 0x87, 0x3d, 0x1a,
    0x4e, 0xaf, 0x5c, 0x12, 0x3b, 0x92, 0xe0, 0x4c, 0x66, 0x29, 0xbd, 0x7e, 0xd4, 0x5f, 0x80, 0x33,
  ]);

  const senderEphemeralPrivate = new Uint8Array([
    0x19, 0xa3, 0x1f, 0xc2, 0x8a, 0x47, 0x6d, 0x9e, 0x2c, 0x55, 0xb1, 0x0d, 0xe8, 0x03, 0x5a, 0x77,
    0x6f, 0x92, 0x11, 0x4b, 0xd9, 0x24, 0x68, 0xae, 0x3f, 0x7a, 0xc0, 0x14, 0x5e, 0x81, 0x2d, 0x99,
  ]);

  const recipientPublicKey = x25519.getPublicKey(recipientPrivateKey);
  const senderEphemeralPublic = x25519.getPublicKey(senderEphemeralPrivate);

  const sharedSecret = x25519.getSharedSecret(senderEphemeralPrivate, recipientPublicKey);
  const symmetricKey = hkdf(sha256, sharedSecret, new Uint8Array(0), HKDF_INFO, 32);

  const bodyNonce = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 12, 23, 34]);
  const subjectNonce = new Uint8Array([21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);

  const plaintext = 'x25519 vector: encrypted inbound body';
  const bodyCipher = chacha20poly1305(symmetricKey, bodyNonce);
  const encryptedBody = bodyCipher.encrypt(textEncoder.encode(plaintext));

  const metadata: X25519Metadata = {
    algorithm: 'x25519-chacha20poly1305',
    ephemeralPublicKey: bytesToBase64(senderEphemeralPublic),
    bodyNonce: bytesToBase64(bodyNonce),
    subjectNonce: bytesToBase64(subjectNonce),
  };

  test('decrypts an x25519 encrypted payload', () => {
    expect(decryptWithX25519(bytesToBase64(encryptedBody), metadata, recipientPrivateKey)).toBe(
      plaintext,
    );
  });

  test('returns undefined with wrong private key', () => {
    const wrongPrivateKey = new Uint8Array(32).fill(1);
    expect(
      decryptWithX25519(bytesToBase64(encryptedBody), metadata, wrongPrivateKey),
    ).toBeUndefined();
  });

  test('returns undefined with corrupted ciphertext', () => {
    expect(decryptWithX25519('not-base64', metadata, recipientPrivateKey)).toBeUndefined();
  });
});

describe('decryptField', () => {
  test('dispatches chacha20-poly1305 to session key path', () => {
    const sessionKey = new Uint8Array(32).fill(5);
    const nonce = new Uint8Array(12).fill(4);
    const plaintext = 'dispatch-session';
    const cipher = chacha20poly1305(sessionKey, nonce);
    const encrypted = cipher.encrypt(textEncoder.encode(plaintext));

    const payload = new Uint8Array(12 + encrypted.length);
    payload.set(nonce, 0);
    payload.set(encrypted, 12);

    const metadata: EncryptionMetadata = { algorithm: 'chacha20-poly1305', version: 1 };
    const result = decryptField(bytesToBase64(payload), metadata, { sessionKey });
    expect(result).toBe(plaintext);
  });

  test('dispatches x25519-chacha20poly1305 to x25519 path', () => {
    const recipientPrivateKey = new Uint8Array(32).fill(42);
    const senderPrivateKey = new Uint8Array(32).fill(99);
    const recipientPublicKey = x25519.getPublicKey(recipientPrivateKey);
    const senderPublicKey = x25519.getPublicKey(senderPrivateKey);
    const shared = x25519.getSharedSecret(senderPrivateKey, recipientPublicKey);
    const key = hkdf(sha256, shared, new Uint8Array(0), HKDF_INFO, 32);

    const nonce = new Uint8Array([7, 1, 4, 2, 8, 3, 9, 5, 6, 0, 11, 12]);
    const plaintext = 'dispatch-x25519';
    const cipher = chacha20poly1305(key, nonce);
    const encrypted = cipher.encrypt(textEncoder.encode(plaintext));

    const metadata: EncryptionMetadata = {
      algorithm: 'x25519-chacha20poly1305',
      ephemeralPublicKey: bytesToBase64(senderPublicKey),
      bodyNonce: bytesToBase64(nonce),
      subjectNonce: bytesToBase64(new Uint8Array(12).fill(1)),
    };

    const result = decryptField(bytesToBase64(encrypted), metadata, {
      x25519PrivateKey: recipientPrivateKey,
    });

    expect(result).toBe(plaintext);
  });

  test('returns undefined for unknown algorithm', () => {
    const metadata = { algorithm: 'unknown' } as unknown as EncryptionMetadata;
    expect(decryptField('abcd', metadata, {})).toBeUndefined();
  });
});
