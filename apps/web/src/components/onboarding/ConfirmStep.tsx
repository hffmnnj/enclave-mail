import { Button } from '@enclave/ui';
import { Tick01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

import type { RegistrationBundle } from '@enclave/crypto';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const getApiBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) {
    return import.meta.env.PUBLIC_API_URL as string;
  }
  return 'http://localhost:3001';
};

interface CreateAccountPayload {
  email: string;
  salt: string;
  verifier: string;
  x25519_public: string;
  ed25519_public: string;
  encrypted_x25519_private: string;
  encrypted_ed25519_private: string;
}

interface CreateAccountResponse {
  userId: string;
}

interface CreateAccountErrorResponse {
  error: string;
}

interface LoginStartResponse {
  B: string;
  salt: string;
}

interface LoginFinishResponse {
  sessionToken: string;
  serverProof: string;
}

// ---------------------------------------------------------------------------
// ConfirmStep
// ---------------------------------------------------------------------------

interface ConfirmStepProps {
  email: string;
  passphrase: string;
  registrationBundle: RegistrationBundle;
  onComplete: (sessionToken: string) => void;
}

const ConfirmStep = ({ email, passphrase, registrationBundle, onComplete }: ConfirmStepProps) => {
  const [status, setStatus] = React.useState<'idle' | 'creating' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = React.useState('');

  const truncateHex = (hex: string): string => {
    if (hex.length <= 16) return hex;
    return `${hex.slice(0, 8)}…${hex.slice(-8)}`;
  };

  const handleCreate = async () => {
    setStatus('creating');
    setErrorMessage('');

    const base = getApiBaseUrl();

    try {
      // Step 1: Create account
      const payload: CreateAccountPayload = {
        email,
        salt: registrationBundle.salt,
        verifier: registrationBundle.verifier,
        x25519_public: registrationBundle.x25519PublicHex,
        ed25519_public: registrationBundle.ed25519PublicHex,
        encrypted_x25519_private: registrationBundle.encryptedX25519PrivateHex,
        encrypted_ed25519_private: registrationBundle.encryptedEd25519PrivateHex,
      };

      const createResp = await fetch(`${base}/account/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!createResp.ok) {
        if (createResp.status === 409) {
          const errBody = (await createResp.json()) as CreateAccountErrorResponse;
          if (errBody.error === 'EMAIL_TAKEN') {
            setErrorMessage('This email is already registered.');
            setStatus('error');
            return;
          }
        }
        throw new Error(`Account creation failed (${String(createResp.status)})`);
      }

      (await createResp.json()) as CreateAccountResponse;

      // Step 2: SRP login to get session token
      const { srpGenerateEphemeral, srpDeriveSession } = await import('@enclave/crypto');

      const clientEphemeral = srpGenerateEphemeral();

      const startResp = await fetch(`${base}/auth/login/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, A: clientEphemeral.public }),
      });

      if (!startResp.ok) {
        throw new Error('Login start failed');
      }

      const { B, salt: serverSalt } = (await startResp.json()) as LoginStartResponse;

      const clientSession = srpDeriveSession(clientEphemeral, B, serverSalt, email, passphrase);

      const finishResp = await fetch(`${base}/auth/login/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, clientProof: clientSession.proof }),
      });

      if (!finishResp.ok) {
        throw new Error('Login finish failed');
      }

      const { sessionToken } = (await finishResp.json()) as LoginFinishResponse;

      // Step 3: Confirm key export
      await fetch(`${base}/account/confirm-key-export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      // Step 4: Store session and redirect
      try {
        localStorage.setItem('enclave:sessionToken', sessionToken);
      } catch {
        // Storage may be unavailable — proceed anyway
      }

      onComplete(sessionToken);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Account creation failed. Please try again.';
      setErrorMessage(message);
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-ui-md font-semibold text-text-primary">Confirm Account</h2>

      {/* Summary */}
      <div className="rounded-sm border border-border bg-background p-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-ui-xs text-text-secondary">Email</span>
          <span className="text-ui-sm text-text-primary font-mono">{email}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-ui-xs text-text-secondary">X25519</span>
          <span className="text-ui-xs text-text-secondary font-mono">
            {truncateHex(registrationBundle.x25519PublicHex)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-ui-xs text-text-secondary">Ed25519</span>
          <span className="text-ui-xs text-text-secondary font-mono">
            {truncateHex(registrationBundle.ed25519PublicHex)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-success">
          <HugeiconsIcon icon={Tick01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
          <span className="text-ui-xs">Key backup saved</span>
        </div>
      </div>

      {/* Error */}
      {status === 'error' && (
        <div className="rounded-sm border border-danger/30 bg-danger/10 p-3">
          <p className="text-ui-xs text-danger">{errorMessage}</p>
          {errorMessage.includes('already registered') && (
            <a href="/login" className="text-ui-xs text-primary hover:underline mt-1 inline-block">
              Sign in instead →
            </a>
          )}
        </div>
      )}

      {/* Create button */}
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={status === 'creating'}
        onClick={() => void handleCreate()}
      >
        {status === 'creating' ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
            Creating account…
          </span>
        ) : (
          'Create Account'
        )}
      </Button>
    </div>
  );
};

export { ConfirmStep };
export type { ConfirmStepProps };
