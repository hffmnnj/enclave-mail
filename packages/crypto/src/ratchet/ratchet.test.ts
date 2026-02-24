import { describe, expect, test } from 'bun:test';

import { generateEd25519KeyPair } from '../ed25519.js';
import { generateX25519KeyPair } from '../x25519.js';
import {
  decryptFromSender,
  decryptMessage,
  deserializeSession,
  encryptForRecipient,
  encryptMessage,
  initSession,
  serializeSession,
} from './double-ratchet.js';
import { generatePreKeyBundle, x3dhInitiateRecipient, x3dhInitiateSender } from './x3dh.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBytes = (value: string): Uint8Array => textEncoder.encode(value);
const toText = (value: Uint8Array): string => textDecoder.decode(value);

const createPairedSessions = () => {
  const aliceIdentity = generateX25519KeyPair();
  const bobIdentity = generateX25519KeyPair();
  const bobEd25519Identity = generateEd25519KeyPair();
  const { bundle, signedPreKeyPair, oneTimePreKeyPair } = generatePreKeyBundle(
    bobIdentity,
    bobEd25519Identity,
    1,
  );

  const aliceInit = x3dhInitiateSender(aliceIdentity, bundle);
  const bobSharedSecret = x3dhInitiateRecipient(
    bobIdentity,
    signedPreKeyPair,
    oneTimePreKeyPair,
    aliceIdentity.publicKey,
    aliceInit.ourEphemeralPublicKey,
  );

  const aliceRatchet = generateX25519KeyPair();
  const aliceSession = initSession(aliceInit.sharedSecret, aliceRatchet, bundle.signedPreKey, true);
  const bobSession = initSession(bobSharedSecret, signedPreKeyPair, null, false);

  return {
    aliceSession,
    bobSession,
    aliceIdentity,
    bobIdentity,
    bundle,
    signedPreKeyPair,
    oneTimePreKeyPair,
  };
};

describe('ratchet', () => {
  test('X3DH session establishment derives identical shared secret', () => {
    const aliceIdentity = generateX25519KeyPair();
    const bobIdentity = generateX25519KeyPair();
    const bobEd25519Identity = generateEd25519KeyPair();
    const { bundle, signedPreKeyPair, oneTimePreKeyPair } = generatePreKeyBundle(
      bobIdentity,
      bobEd25519Identity,
      7,
    );

    const alice = x3dhInitiateSender(aliceIdentity, bundle);
    const bob = x3dhInitiateRecipient(
      bobIdentity,
      signedPreKeyPair,
      oneTimePreKeyPair,
      aliceIdentity.publicKey,
      alice.ourEphemeralPublicKey,
    );

    expect(alice.sharedSecret).toEqual(bob);
    expect(alice.sharedSecret).toHaveLength(32);
  });

  test('message roundtrip encrypts and decrypts', () => {
    const { aliceSession, bobSession } = createPairedSessions();

    const outbound = encryptMessage(aliceSession, toBytes('hello bob'));
    const inbound = decryptMessage(bobSession, outbound.message);

    expect(toText(inbound.plaintext)).toBe('hello bob');
    expect(outbound.session.sendingMessageNumber).toBe(1);
    expect(inbound.session.receivingMessageNumber).toBe(1);
  });

  test('forward secrecy holds across DH ratchet transitions', () => {
    const { aliceSession, bobSession } = createPairedSessions();

    const first = encryptMessage(aliceSession, toBytes('phase-1'));
    const bobAfterFirst = decryptMessage(bobSession, first.message);

    const staleBobState = bobSession;

    const reply = encryptMessage(bobAfterFirst.session, toBytes('phase-2'));
    const aliceAfterReply = decryptMessage(first.session, reply.message);

    const third = encryptMessage(aliceAfterReply.session, toBytes('phase-3'));

    expect(() => decryptMessage(staleBobState, third.message)).toThrow();

    const bobAfterThird = decryptMessage(reply.session, third.message);
    expect(toText(bobAfterThird.plaintext)).toBe('phase-3');
  });

  test('multiple messages in sequence decrypt correctly', () => {
    const { aliceSession, bobSession } = createPairedSessions();

    let sender = aliceSession;
    let receiver = bobSession;

    for (let index = 0; index < 5; index += 1) {
      const payload = `msg-${index}`;
      const outbound = encryptMessage(sender, toBytes(payload));
      const inbound = decryptMessage(receiver, outbound.message);

      expect(toText(inbound.plaintext)).toBe(payload);

      sender = outbound.session;
      receiver = inbound.session;
    }

    expect(sender.sendingMessageNumber).toBe(5);
    expect(receiver.receivingMessageNumber).toBe(5);
  });

  test('session serialization roundtrip preserves state', () => {
    const { aliceSession, bobSession } = createPairedSessions();

    const first = encryptMessage(aliceSession, toBytes('serialized-1'));
    const bobAfterFirst = decryptMessage(bobSession, first.message);

    const aliceSerialized = serializeSession(first.session);
    const bobSerialized = serializeSession(bobAfterFirst.session);

    const restoredAlice = deserializeSession(aliceSerialized);
    const restoredBob = deserializeSession(bobSerialized);

    const second = encryptMessage(restoredAlice, toBytes('serialized-2'));
    const bobAfterSecond = decryptMessage(restoredBob, second.message);

    expect(toText(bobAfterSecond.plaintext)).toBe('serialized-2');
  });

  test('per-message external encryption roundtrips', () => {
    const recipient = generateX25519KeyPair();
    const plaintext = toBytes('external encrypted body');

    const encrypted = encryptForRecipient(recipient.publicKey, plaintext);
    const decrypted = decryptFromSender(
      recipient.privateKey,
      encrypted.ephemeralPublicKey,
      encrypted.ciphertext,
    );

    expect(decrypted).toEqual(plaintext);
  });

  test('out-of-order messages decrypt with skipped-key cache', () => {
    const { aliceSession, bobSession } = createPairedSessions();

    const first = encryptMessage(aliceSession, toBytes('m1'));
    const second = encryptMessage(first.session, toBytes('m2'));
    const third = encryptMessage(second.session, toBytes('m3'));

    const afterFirst = decryptMessage(bobSession, first.message);
    const afterThird = decryptMessage(afterFirst.session, third.message);
    const afterSecond = decryptMessage(afterThird.session, second.message);

    expect(toText(afterFirst.plaintext)).toBe('m1');
    expect(toText(afterThird.plaintext)).toBe('m3');
    expect(toText(afterSecond.plaintext)).toBe('m2');
  });

  test('tampered ciphertext fails decryption', () => {
    const { aliceSession, bobSession } = createPairedSessions();

    const outbound = encryptMessage(aliceSession, toBytes('do-not-tamper'));
    const tamperedCiphertext = outbound.message.ciphertext.slice();
    const targetIndex = tamperedCiphertext.length - 1;
    const targetByte = tamperedCiphertext[targetIndex];

    if (targetByte === undefined) {
      throw new Error('Ciphertext unexpectedly empty');
    }

    tamperedCiphertext[targetIndex] = targetByte ^ 0xff;

    expect(() =>
      decryptMessage(bobSession, {
        ...outbound.message,
        ciphertext: tamperedCiphertext,
      }),
    ).toThrow();
  });
});
