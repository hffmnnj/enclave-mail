import * as srpClient from 'secure-remote-password/client';

import type { SrpClientEphemeral, SrpClientSession, SrpRegistrationResult } from './types.js';

export const srpRegister = (email: string, password: string): SrpRegistrationResult => {
  const salt = srpClient.generateSalt();
  const privateKey = srpClient.derivePrivateKey(salt, email, password);
  const verifier = srpClient.deriveVerifier(privateKey);

  return { salt, verifier };
};

export const srpGenerateEphemeral = (): SrpClientEphemeral => srpClient.generateEphemeral();

export const srpDeriveSession = (
  clientEphemeral: SrpClientEphemeral,
  serverPublicEphemeral: string,
  salt: string,
  email: string,
  password: string,
): SrpClientSession => {
  const privateKey = srpClient.derivePrivateKey(salt, email, password);

  return srpClient.deriveSession(
    clientEphemeral.secret,
    serverPublicEphemeral,
    salt,
    email,
    privateKey,
  );
};

export const srpVerifyServerProof = (
  clientPublicEphemeral: string,
  clientSession: SrpClientSession,
  serverProof: string,
): void => {
  srpClient.verifySession(clientPublicEphemeral, clientSession, serverProof);
};
