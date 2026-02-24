import * as srpServer from 'secure-remote-password/server';

import type { SrpServerEphemeral, SrpServerSession } from './types.js';

export const srpGenerateServerEphemeral = (verifier: string): SrpServerEphemeral =>
  srpServer.generateEphemeral(verifier);

export const srpDeriveServerSession = (
  serverEphemeral: SrpServerEphemeral,
  clientPublicEphemeral: string,
  salt: string,
  email: string,
  verifier: string,
  clientProof: string,
): SrpServerSession =>
  srpServer.deriveSession(
    serverEphemeral.secret,
    clientPublicEphemeral,
    salt,
    email,
    verifier,
    clientProof,
  );
