import { describe, expect, test } from 'bun:test';

import {
  srpDeriveSession,
  srpGenerateEphemeral,
  srpRegister,
  srpVerifyServerProof,
} from './client.js';
import { srpDeriveServerSession, srpGenerateServerEphemeral } from './server.js';
import type { SrpServerEphemeral, SrpServerSession } from './types.js';

const TEST_EMAIL = 'alice@enclave.test';
const TEST_PASSWORD = 'correct horse battery staple';

const assertServerSignatures = (
  _generate: (verifier: string) => SrpServerEphemeral,
  _derive: (
    serverEphemeral: SrpServerEphemeral,
    clientPublicEphemeral: string,
    salt: string,
    email: string,
    verifier: string,
    clientProof: string,
  ) => SrpServerSession,
): true => true;

describe('srp', () => {
  test('full registration and login flow succeeds', () => {
    const registration = srpRegister(TEST_EMAIL, TEST_PASSWORD);
    const clientEphemeral = srpGenerateEphemeral();
    const serverEphemeral = srpGenerateServerEphemeral(registration.verifier);
    const clientSession = srpDeriveSession(
      clientEphemeral,
      serverEphemeral.public,
      registration.salt,
      TEST_EMAIL,
      TEST_PASSWORD,
    );
    const serverSession = srpDeriveServerSession(
      serverEphemeral,
      clientEphemeral.public,
      registration.salt,
      TEST_EMAIL,
      registration.verifier,
      clientSession.proof,
    );

    expect(clientSession.key).toBe(serverSession.key);
  });

  test('client verifies server proof for mutual authentication', () => {
    const registration = srpRegister(TEST_EMAIL, TEST_PASSWORD);
    const clientEphemeral = srpGenerateEphemeral();
    const serverEphemeral = srpGenerateServerEphemeral(registration.verifier);
    const clientSession = srpDeriveSession(
      clientEphemeral,
      serverEphemeral.public,
      registration.salt,
      TEST_EMAIL,
      TEST_PASSWORD,
    );
    const serverSession = srpDeriveServerSession(
      serverEphemeral,
      clientEphemeral.public,
      registration.salt,
      TEST_EMAIL,
      registration.verifier,
      clientSession.proof,
    );

    expect(() => {
      srpVerifyServerProof(clientEphemeral.public, clientSession, serverSession.proof);
    }).not.toThrow();
  });

  test('wrong password is rejected by the server session derivation', () => {
    const registration = srpRegister(TEST_EMAIL, TEST_PASSWORD);
    const clientEphemeral = srpGenerateEphemeral();
    const serverEphemeral = srpGenerateServerEphemeral(registration.verifier);
    const clientSessionWithWrongPassword = srpDeriveSession(
      clientEphemeral,
      serverEphemeral.public,
      registration.salt,
      TEST_EMAIL,
      'definitely wrong password',
    );

    expect(() => {
      srpDeriveServerSession(
        serverEphemeral,
        clientEphemeral.public,
        registration.salt,
        TEST_EMAIL,
        registration.verifier,
        clientSessionWithWrongPassword.proof,
      );
    }).toThrow();
  });

  test('server functions are typed without a plaintext password parameter', () => {
    const hasExpectedSignature = assertServerSignatures(
      srpGenerateServerEphemeral,
      srpDeriveServerSession,
    );

    expect(hasExpectedSignature).toBe(true);
    expect(srpGenerateServerEphemeral.length).toBe(1);
    expect(srpDeriveServerSession.length).toBe(6);
    expect(srpDeriveServerSession.toString().includes('password')).toBe(false);
  });

  test('registration uses unique salts for identical credentials', () => {
    const first = srpRegister(TEST_EMAIL, TEST_PASSWORD);
    const second = srpRegister(TEST_EMAIL, TEST_PASSWORD);

    expect(first.salt).not.toBe(second.salt);
    expect(first.verifier).not.toBe(second.verifier);
  });
});
