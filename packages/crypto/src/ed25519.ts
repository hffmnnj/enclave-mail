import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

const ED25519_PRIVATE_KEY_LENGTH = 32;
const ED25519_PUBLIC_KEY_LENGTH = 32;
const ED25519_SIGNATURE_LENGTH = 64;
const FINGERPRINT_BYTE_LENGTH = 8;

const assertKeyLength = (key: Uint8Array, expectedLength: number, label: string): void => {
  if (key.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes`);
  }
};

const encodeBase64Url = (bytes: Uint8Array): string => {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const decodeBase64Url = (encoded: string): Uint8Array => {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export type Ed25519KeyPair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export const generateEd25519KeyPair = (): Ed25519KeyPair => {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);

  assertKeyLength(privateKey, ED25519_PRIVATE_KEY_LENGTH, 'Ed25519 private key');
  assertKeyLength(publicKey, ED25519_PUBLIC_KEY_LENGTH, 'Ed25519 public key');

  return { privateKey, publicKey };
};

export const sign = (message: Uint8Array, privateKey: Uint8Array): Uint8Array => {
  assertKeyLength(privateKey, ED25519_PRIVATE_KEY_LENGTH, 'Ed25519 private key');
  return ed25519.sign(message, privateKey);
};

export const verify = (
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean => {
  try {
    assertKeyLength(signature, ED25519_SIGNATURE_LENGTH, 'Ed25519 signature');
    assertKeyLength(publicKey, ED25519_PUBLIC_KEY_LENGTH, 'Ed25519 public key');
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
};

export const getFingerprint = (publicKey: Uint8Array): string => {
  assertKeyLength(publicKey, ED25519_PUBLIC_KEY_LENGTH, 'Ed25519 public key');
  const digest = sha256(publicKey);
  const truncated = digest.slice(0, FINGERPRINT_BYTE_LENGTH);
  return toHex(truncated);
};

export const serializePublicKey = (publicKey: Uint8Array): string => {
  assertKeyLength(publicKey, ED25519_PUBLIC_KEY_LENGTH, 'Ed25519 public key');
  return encodeBase64Url(publicKey);
};

export const deserializePublicKey = (encoded: string): Uint8Array => {
  const publicKey = decodeBase64Url(encoded);
  assertKeyLength(publicKey, ED25519_PUBLIC_KEY_LENGTH, 'Ed25519 public key');
  return publicKey;
};

export const serializePrivateKey = (privateKey: Uint8Array): string => {
  assertKeyLength(privateKey, ED25519_PRIVATE_KEY_LENGTH, 'Ed25519 private key');
  return encodeBase64Url(privateKey);
};

export const deserializePrivateKey = (encoded: string): Uint8Array => {
  const privateKey = decodeBase64Url(encoded);
  assertKeyLength(privateKey, ED25519_PRIVATE_KEY_LENGTH, 'Ed25519 private key');
  return privateKey;
};
