import { x25519 } from '@noble/curves/ed25519.js';

const X25519_KEY_LENGTH = 32;

const assertKeyLength = (key: Uint8Array, label: string): void => {
  if (key.length !== X25519_KEY_LENGTH) {
    throw new Error(`${label} must be ${X25519_KEY_LENGTH} bytes`);
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

export type X25519KeyPair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export const generateX25519KeyPair = (): X25519KeyPair => {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);

  assertKeyLength(privateKey, 'X25519 private key');
  assertKeyLength(publicKey, 'X25519 public key');

  return { privateKey, publicKey };
};

export const computeSharedSecret = (
  privateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): Uint8Array => {
  assertKeyLength(privateKey, 'X25519 private key');
  assertKeyLength(theirPublicKey, 'X25519 public key');

  return x25519.getSharedSecret(privateKey, theirPublicKey);
};

export const serializePublicKey = (publicKey: Uint8Array): string => {
  assertKeyLength(publicKey, 'X25519 public key');
  return encodeBase64Url(publicKey);
};

export const deserializePublicKey = (encoded: string): Uint8Array => {
  const publicKey = decodeBase64Url(encoded);
  assertKeyLength(publicKey, 'X25519 public key');
  return publicKey;
};

export const serializePrivateKey = (privateKey: Uint8Array): string => {
  assertKeyLength(privateKey, 'X25519 private key');
  return encodeBase64Url(privateKey);
};

export const deserializePrivateKey = (encoded: string): Uint8Array => {
  const privateKey = decodeBase64Url(encoded);
  assertKeyLength(privateKey, 'X25519 private key');
  return privateKey;
};
