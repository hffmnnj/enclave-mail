import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import type {
  DhKeyPair,
  EncryptedMessage,
  ExternalEncryptedMessage,
  MessageHeader,
  RatchetSession,
} from './types.js';

const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const MAX_SKIPPED_KEYS = 64;
const EMPTY_SALT = new Uint8Array(KEY_LENGTH);

const ROOT_INFO = new TextEncoder().encode('enclave-ratchet-root');
const SEND_INFO = new TextEncoder().encode('enclave-ratchet-send');
const MSG_INFO = new TextEncoder().encode('enclave-ratchet-msg');
const EXTERNAL_INFO = new TextEncoder().encode('enclave-external-msg-v1');

const assertKeyLength = (key: Uint8Array, label: string): void => {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${label} must be ${KEY_LENGTH} bytes`);
  }
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex value');
  }

  const output = new Uint8Array(hex.length / 2);

  for (let i = 0; i < output.length; i += 1) {
    const byte = hex.slice(i * 2, i * 2 + 2);
    const parsed = Number.parseInt(byte, 16);

    if (Number.isNaN(parsed)) {
      throw new Error('Invalid hex value');
    }

    output[i] = parsed;
  }

  return output;
};

const arraysEqual = (left: Uint8Array | null, right: Uint8Array | null): boolean => {
  if (left === null || right === null) {
    return left === right;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
};

const serializeHeader = (header: MessageHeader): Uint8Array => {
  assertKeyLength(header.dhRatchetKey, 'DH ratchet public key');
  const output = new Uint8Array(KEY_LENGTH + 8);
  output.set(header.dhRatchetKey, 0);

  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  view.setUint32(KEY_LENGTH, header.messageNumber);
  view.setUint32(KEY_LENGTH + 4, header.previousChainLength);

  return output;
};

const cloneSession = (session: RatchetSession): RatchetSession => ({
  dhSendingKey: session.dhSendingKey.slice(),
  dhReceivingKey: session.dhReceivingKey === null ? null : session.dhReceivingKey.slice(),
  rootKey: session.rootKey.slice(),
  sendingChainKey: session.sendingChainKey === null ? null : session.sendingChainKey.slice(),
  receivingChainKey: session.receivingChainKey === null ? null : session.receivingChainKey.slice(),
  sendingMessageNumber: session.sendingMessageNumber,
  receivingMessageNumber: session.receivingMessageNumber,
  previousSendingChainLength: session.previousSendingChainLength,
  skippedMessageKeys: new Map(
    Array.from(session.skippedMessageKeys.entries(), ([key, value]) => [key, value.slice()]),
  ),
});

const headerCacheKey = (dhRatchetKey: Uint8Array, messageNumber: number): string =>
  `${toHex(dhRatchetKey)}:${messageNumber}`;

const kdfRootChain = (rootKey: Uint8Array, dhOutput: Uint8Array): [Uint8Array, Uint8Array] => {
  const output = hkdf(sha256, dhOutput, rootKey, ROOT_INFO, KEY_LENGTH * 2);
  return [output.slice(0, KEY_LENGTH), output.slice(KEY_LENGTH, KEY_LENGTH * 2)];
};

const kdfChain = (chainKey: Uint8Array): [Uint8Array, Uint8Array] => {
  const newChainKey = hmac(sha256, chainKey, SEND_INFO);
  const messageKey = hmac(sha256, chainKey, MSG_INFO);
  return [newChainKey, messageKey];
};

const decryptWithMessageKey = (
  messageKey: Uint8Array,
  header: MessageHeader,
  ciphertext: Uint8Array,
): Uint8Array => {
  if (ciphertext.length < NONCE_LENGTH + 16) {
    throw new Error('Ciphertext is too short');
  }

  const nonce = ciphertext.slice(0, NONCE_LENGTH);
  const encryptedPayload = ciphertext.slice(NONCE_LENGTH);
  const cipher = chacha20poly1305(messageKey, nonce, serializeHeader(header));
  return cipher.decrypt(encryptedPayload);
};

const computeDh = (privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array => {
  assertKeyLength(privateKey, 'X25519 private key');
  assertKeyLength(publicKey, 'X25519 public key');
  return x25519.getSharedSecret(privateKey, publicKey);
};

const requireSendingChain = (session: RatchetSession): Uint8Array => {
  if (session.sendingChainKey === null) {
    throw new Error('Sending chain is not initialized');
  }

  return session.sendingChainKey;
};

const requireReceivingChain = (session: RatchetSession): Uint8Array => {
  if (session.receivingChainKey === null) {
    throw new Error('Receiving chain is not initialized');
  }

  return session.receivingChainKey;
};

const withBoundedSkippedKeys = (map: Map<string, Uint8Array>): Map<string, Uint8Array> => {
  while (map.size > MAX_SKIPPED_KEYS) {
    const oldestKey = map.keys().next().value;

    if (oldestKey === undefined) {
      break;
    }

    map.delete(oldestKey);
  }

  return map;
};

const skipMessageKeys = (session: RatchetSession, untilMessageNumber: number): RatchetSession => {
  if (session.receivingChainKey === null || session.dhReceivingKey === null) {
    return session;
  }

  if (untilMessageNumber < session.receivingMessageNumber) {
    return session;
  }

  let next = cloneSession(session);
  while (next.receivingMessageNumber < untilMessageNumber) {
    const currentDhReceivingKey = next.dhReceivingKey;

    if (currentDhReceivingKey === null) {
      throw new Error('Missing DH receiving key while skipping messages');
    }

    const receivingChainKey = requireReceivingChain(next);
    const [updatedChainKey, messageKey] = kdfChain(receivingChainKey);
    const cacheKey = headerCacheKey(currentDhReceivingKey, next.receivingMessageNumber);

    next = {
      ...next,
      receivingChainKey: updatedChainKey,
      receivingMessageNumber: next.receivingMessageNumber + 1,
      skippedMessageKeys: withBoundedSkippedKeys(
        new Map(next.skippedMessageKeys).set(cacheKey, messageKey),
      ),
    };
  }

  return next;
};

const applyDhRatchet = (session: RatchetSession, theirNewPublicKey: Uint8Array): RatchetSession => {
  assertKeyLength(theirNewPublicKey, 'Peer DH ratchet key');

  let next = cloneSession(session);

  next = skipMessageKeys(next, next.receivingMessageNumber);

  const firstDh = computeDh(next.dhSendingKey, theirNewPublicKey);
  const [rootAfterReceive, receivingChainKey] = kdfRootChain(next.rootKey, firstDh);

  const newSendingPrivateKey = x25519.utils.randomSecretKey();
  const secondDh = computeDh(newSendingPrivateKey, theirNewPublicKey);
  const [rootAfterSend, sendingChainKey] = kdfRootChain(rootAfterReceive, secondDh);

  return {
    ...next,
    rootKey: rootAfterSend,
    dhSendingKey: newSendingPrivateKey,
    dhReceivingKey: theirNewPublicKey.slice(),
    sendingChainKey,
    receivingChainKey,
    previousSendingChainLength: next.sendingMessageNumber,
    sendingMessageNumber: 0,
    receivingMessageNumber: 0,
  };
};

export const initSession = (
  sharedSecret: Uint8Array,
  ourRatchetKeyPair: DhKeyPair,
  theirRatchetPublicKey: Uint8Array | null,
  isInitiator: boolean,
): RatchetSession => {
  assertKeyLength(sharedSecret, 'Shared secret');
  assertKeyLength(ourRatchetKeyPair.privateKey, 'Our ratchet private key');
  assertKeyLength(ourRatchetKeyPair.publicKey, 'Our ratchet public key');

  if (isInitiator) {
    if (theirRatchetPublicKey === null) {
      throw new Error('Initiator requires recipient ratchet public key');
    }

    assertKeyLength(theirRatchetPublicKey, 'Recipient ratchet public key');
    const dhOutput = computeDh(ourRatchetKeyPair.privateKey, theirRatchetPublicKey);
    const [rootKey, sendingChainKey] = kdfRootChain(sharedSecret, dhOutput);

    return {
      dhSendingKey: ourRatchetKeyPair.privateKey.slice(),
      dhReceivingKey: theirRatchetPublicKey.slice(),
      rootKey,
      sendingChainKey,
      receivingChainKey: null,
      sendingMessageNumber: 0,
      receivingMessageNumber: 0,
      previousSendingChainLength: 0,
      skippedMessageKeys: new Map(),
    };
  }

  return {
    dhSendingKey: ourRatchetKeyPair.privateKey.slice(),
    dhReceivingKey: theirRatchetPublicKey === null ? null : theirRatchetPublicKey.slice(),
    rootKey: sharedSecret.slice(),
    sendingChainKey: null,
    receivingChainKey: null,
    sendingMessageNumber: 0,
    receivingMessageNumber: 0,
    previousSendingChainLength: 0,
    skippedMessageKeys: new Map(),
  };
};

export const encryptMessage = (
  session: RatchetSession,
  plaintext: Uint8Array,
): { session: RatchetSession; message: EncryptedMessage } => {
  const next = cloneSession(session);
  const sendingChainKey = requireSendingChain(next);

  const [updatedChainKey, messageKey] = kdfChain(sendingChainKey);
  const ratchetPublicKey = x25519.getPublicKey(next.dhSendingKey);
  const header: MessageHeader = {
    dhRatchetKey: ratchetPublicKey,
    messageNumber: next.sendingMessageNumber,
    previousChainLength: next.previousSendingChainLength,
  };

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = chacha20poly1305(messageKey, nonce, serializeHeader(header));
  const encryptedPayload = cipher.encrypt(plaintext);
  const ciphertext = new Uint8Array(nonce.length + encryptedPayload.length);
  ciphertext.set(nonce, 0);
  ciphertext.set(encryptedPayload, nonce.length);

  return {
    session: {
      ...next,
      sendingChainKey: updatedChainKey,
      sendingMessageNumber: next.sendingMessageNumber + 1,
    },
    message: {
      header,
      ciphertext,
    },
  };
};

export const decryptMessage = (
  session: RatchetSession,
  message: EncryptedMessage,
): { session: RatchetSession; plaintext: Uint8Array } => {
  const cachedKeyId = headerCacheKey(message.header.dhRatchetKey, message.header.messageNumber);

  const cachedKey = session.skippedMessageKeys.get(cachedKeyId);

  if (cachedKey !== undefined) {
    const plaintext = decryptWithMessageKey(cachedKey, message.header, message.ciphertext);
    const updatedSkippedKeys = new Map(session.skippedMessageKeys);
    updatedSkippedKeys.delete(cachedKeyId);

    return {
      session: {
        ...cloneSession(session),
        skippedMessageKeys: updatedSkippedKeys,
      },
      plaintext,
    };
  }

  let next = cloneSession(session);

  if (!arraysEqual(next.dhReceivingKey, message.header.dhRatchetKey)) {
    next = skipMessageKeys(next, message.header.previousChainLength);
    next = applyDhRatchet(next, message.header.dhRatchetKey);
  }

  if (message.header.messageNumber < next.receivingMessageNumber) {
    throw new Error('Message key not found in skipped key cache');
  }

  next = skipMessageKeys(next, message.header.messageNumber);

  const receivingChainKey = requireReceivingChain(next);
  const [updatedChainKey, messageKey] = kdfChain(receivingChainKey);
  const plaintext = decryptWithMessageKey(messageKey, message.header, message.ciphertext);

  return {
    session: {
      ...next,
      receivingChainKey: updatedChainKey,
      receivingMessageNumber: next.receivingMessageNumber + 1,
    },
    plaintext,
  };
};

interface SerializedRatchetSession {
  dhSendingKey: string;
  dhReceivingKey: string | null;
  rootKey: string;
  sendingChainKey: string | null;
  receivingChainKey: string | null;
  sendingMessageNumber: number;
  receivingMessageNumber: number;
  previousSendingChainLength: number;
  skippedMessageKeys: Array<[string, string]>;
}

export const serializeSession = (session: RatchetSession): string => {
  const payload: SerializedRatchetSession = {
    dhSendingKey: toHex(session.dhSendingKey),
    dhReceivingKey: session.dhReceivingKey === null ? null : toHex(session.dhReceivingKey),
    rootKey: toHex(session.rootKey),
    sendingChainKey: session.sendingChainKey === null ? null : toHex(session.sendingChainKey),
    receivingChainKey: session.receivingChainKey === null ? null : toHex(session.receivingChainKey),
    sendingMessageNumber: session.sendingMessageNumber,
    receivingMessageNumber: session.receivingMessageNumber,
    previousSendingChainLength: session.previousSendingChainLength,
    skippedMessageKeys: Array.from(session.skippedMessageKeys.entries(), ([key, value]) => [
      key,
      toHex(value),
    ]),
  };

  return JSON.stringify(payload);
};

const isSerializedSession = (value: unknown): value is SerializedRatchetSession => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.dhSendingKey === 'string' &&
    (typeof candidate.dhReceivingKey === 'string' || candidate.dhReceivingKey === null) &&
    typeof candidate.rootKey === 'string' &&
    (typeof candidate.sendingChainKey === 'string' || candidate.sendingChainKey === null) &&
    (typeof candidate.receivingChainKey === 'string' || candidate.receivingChainKey === null) &&
    typeof candidate.sendingMessageNumber === 'number' &&
    typeof candidate.receivingMessageNumber === 'number' &&
    typeof candidate.previousSendingChainLength === 'number' &&
    Array.isArray(candidate.skippedMessageKeys)
  );
};

export const deserializeSession = (json: string): RatchetSession => {
  const parsed: unknown = JSON.parse(json);

  if (!isSerializedSession(parsed)) {
    throw new Error('Invalid serialized ratchet session');
  }

  const skipped = new Map<string, Uint8Array>();

  for (const entry of parsed.skippedMessageKeys) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error('Invalid serialized skipped message key entry');
    }

    const [key, value] = entry;

    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid serialized skipped message key types');
    }

    skipped.set(key, fromHex(value));
  }

  return {
    dhSendingKey: fromHex(parsed.dhSendingKey),
    dhReceivingKey: parsed.dhReceivingKey === null ? null : fromHex(parsed.dhReceivingKey),
    rootKey: fromHex(parsed.rootKey),
    sendingChainKey: parsed.sendingChainKey === null ? null : fromHex(parsed.sendingChainKey),
    receivingChainKey: parsed.receivingChainKey === null ? null : fromHex(parsed.receivingChainKey),
    sendingMessageNumber: parsed.sendingMessageNumber,
    receivingMessageNumber: parsed.receivingMessageNumber,
    previousSendingChainLength: parsed.previousSendingChainLength,
    skippedMessageKeys: skipped,
  };
};

export const encryptForRecipient = (
  recipientPublicKey: Uint8Array,
  plaintext: Uint8Array,
): ExternalEncryptedMessage => {
  assertKeyLength(recipientPublicKey, 'Recipient public key');

  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = computeDh(ephemeralPrivateKey, recipientPublicKey);
  const symmetricKey = hkdf(sha256, sharedSecret, EMPTY_SALT, EXTERNAL_INFO, KEY_LENGTH);

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = chacha20poly1305(symmetricKey, nonce, ephemeralPublicKey);
  const encryptedPayload = cipher.encrypt(plaintext);

  const ciphertext = new Uint8Array(nonce.length + encryptedPayload.length);
  ciphertext.set(nonce, 0);
  ciphertext.set(encryptedPayload, nonce.length);

  return {
    ciphertext,
    ephemeralPublicKey,
  };
};

export const decryptFromSender = (
  ourPrivateKey: Uint8Array,
  senderEphemeralPublicKey: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array => {
  assertKeyLength(ourPrivateKey, 'Recipient private key');
  assertKeyLength(senderEphemeralPublicKey, 'Sender ephemeral public key');

  if (ciphertext.length < NONCE_LENGTH + 16) {
    throw new Error('Ciphertext is too short');
  }

  const sharedSecret = computeDh(ourPrivateKey, senderEphemeralPublicKey);
  const symmetricKey = hkdf(sha256, sharedSecret, EMPTY_SALT, EXTERNAL_INFO, KEY_LENGTH);

  const nonce = ciphertext.slice(0, NONCE_LENGTH);
  const encryptedPayload = ciphertext.slice(NONCE_LENGTH);
  const cipher = chacha20poly1305(symmetricKey, nonce, senderEphemeralPublicKey);
  return cipher.decrypt(encryptedPayload);
};
