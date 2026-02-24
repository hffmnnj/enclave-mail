import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import type { DhKeyPair, PreKeyBundle, X3dhInitiationResult } from './types.js';

const KEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;
const HKDF_SALT_LENGTH = 32;
const X3DH_INFO = new TextEncoder().encode('enclave-x3dh-v1');

const assertKeyLength = (key: Uint8Array, label: string): void => {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${label} must be ${KEY_LENGTH} bytes`);
  }
};

const assertSignatureLength = (signature: Uint8Array, label: string): void => {
  if (signature.length !== SIGNATURE_LENGTH) {
    throw new Error(`${label} must be ${SIGNATURE_LENGTH} bytes`);
  }
};

const concatenate = (parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
};

const deriveX3dhSharedSecret = (dhOutputs: Uint8Array[]): Uint8Array => {
  const ikm = concatenate(dhOutputs);
  const salt = new Uint8Array(HKDF_SALT_LENGTH);
  return hkdf(sha256, ikm, salt, X3DH_INFO, KEY_LENGTH);
};

const computeDh = (privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array => {
  assertKeyLength(privateKey, 'X25519 private key');
  assertKeyLength(publicKey, 'X25519 public key');
  return x25519.getSharedSecret(privateKey, publicKey);
};

const verifySignedPreKey = (bundle: PreKeyBundle): void => {
  assertKeyLength(bundle.signedPreKey, 'Signed prekey');
  assertSignatureLength(bundle.signedPreKeySignature, 'Signed prekey signature');
  assertKeyLength(bundle.ed25519IdentityKey, 'Ed25519 identity key');

  const isValid = ed25519.verify(
    bundle.signedPreKeySignature,
    bundle.signedPreKey,
    bundle.ed25519IdentityKey,
  );

  if (!isValid) {
    throw new Error('Signed prekey signature verification failed');
  }
};

export const generatePreKeyBundle = (
  identityKeyPair: DhKeyPair,
  ed25519IdentityKeyPair: DhKeyPair,
  registrationId: number,
): {
  bundle: PreKeyBundle;
  signedPreKeyPair: DhKeyPair;
  oneTimePreKeyPair: DhKeyPair;
} => {
  assertKeyLength(identityKeyPair.privateKey, 'Identity private key');
  assertKeyLength(identityKeyPair.publicKey, 'Identity public key');
  assertKeyLength(ed25519IdentityKeyPair.privateKey, 'Ed25519 identity private key');
  assertKeyLength(ed25519IdentityKeyPair.publicKey, 'Ed25519 identity public key');

  const signedPreKeyPrivate = x25519.utils.randomSecretKey();
  const signedPreKeyPublic = x25519.getPublicKey(signedPreKeyPrivate);
  const oneTimePreKeyPrivate = x25519.utils.randomSecretKey();
  const oneTimePreKeyPublic = x25519.getPublicKey(oneTimePreKeyPrivate);

  const signedPreKeySignature = ed25519.sign(signedPreKeyPublic, ed25519IdentityKeyPair.privateKey);

  return {
    bundle: {
      identityKey: identityKeyPair.publicKey,
      signedPreKey: signedPreKeyPublic,
      signedPreKeySignature,
      oneTimePreKey: oneTimePreKeyPublic,
      registrationId,
      ed25519IdentityKey: ed25519IdentityKeyPair.publicKey,
    },
    signedPreKeyPair: {
      privateKey: signedPreKeyPrivate,
      publicKey: signedPreKeyPublic,
    },
    oneTimePreKeyPair: {
      privateKey: oneTimePreKeyPrivate,
      publicKey: oneTimePreKeyPublic,
    },
  };
};

export const x3dhInitiateSender = (
  senderIdentityKeyPair: DhKeyPair,
  recipientBundle: PreKeyBundle,
): X3dhInitiationResult => {
  assertKeyLength(senderIdentityKeyPair.privateKey, 'Sender identity private key');
  assertKeyLength(senderIdentityKeyPair.publicKey, 'Sender identity public key');
  assertKeyLength(recipientBundle.identityKey, 'Recipient identity key');
  assertKeyLength(recipientBundle.signedPreKey, 'Recipient signed prekey');

  if (recipientBundle.oneTimePreKey !== undefined) {
    assertKeyLength(recipientBundle.oneTimePreKey, 'Recipient one-time prekey');
  }

  verifySignedPreKey(recipientBundle);

  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

  const dhValues = [
    computeDh(senderIdentityKeyPair.privateKey, recipientBundle.signedPreKey),
    computeDh(ephemeralPrivateKey, recipientBundle.identityKey),
    computeDh(ephemeralPrivateKey, recipientBundle.signedPreKey),
  ];

  if (recipientBundle.oneTimePreKey !== undefined) {
    dhValues.push(computeDh(ephemeralPrivateKey, recipientBundle.oneTimePreKey));
  }

  return {
    sharedSecret: deriveX3dhSharedSecret(dhValues),
    ourEphemeralPublicKey: ephemeralPublicKey,
  };
};

export const x3dhInitiateRecipient = (
  recipientIdentityKeyPair: DhKeyPair,
  recipientSignedPreKeyPair: DhKeyPair,
  recipientOneTimePreKeyPair: DhKeyPair | null,
  senderIdentityKey: Uint8Array,
  senderEphemeralKey: Uint8Array,
): Uint8Array => {
  assertKeyLength(recipientIdentityKeyPair.privateKey, 'Recipient identity private key');
  assertKeyLength(recipientSignedPreKeyPair.privateKey, 'Recipient signed prekey private key');
  assertKeyLength(senderIdentityKey, 'Sender identity public key');
  assertKeyLength(senderEphemeralKey, 'Sender ephemeral public key');

  const dhValues = [
    computeDh(recipientSignedPreKeyPair.privateKey, senderIdentityKey),
    computeDh(recipientIdentityKeyPair.privateKey, senderEphemeralKey),
    computeDh(recipientSignedPreKeyPair.privateKey, senderEphemeralKey),
  ];

  if (recipientOneTimePreKeyPair !== null) {
    assertKeyLength(recipientOneTimePreKeyPair.privateKey, 'Recipient one-time prekey private key');
    dhValues.push(computeDh(recipientOneTimePreKeyPair.privateKey, senderEphemeralKey));
  }

  return deriveX3dhSharedSecret(dhValues);
};
