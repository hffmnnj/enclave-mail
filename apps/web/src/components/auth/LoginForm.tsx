import { Button, Input } from '@enclave/ui';
import { ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

import {
  clearInMemorySessionSecrets,
  decryptX25519PrivateKeyFromExportBlob,
  deriveSessionKeyFromPassphrase,
} from '../../lib/crypto-client.js';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const getApiBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) {
    return import.meta.env.PUBLIC_API_URL as string;
  }
  return 'http://localhost:3001';
};

interface LoginStartResponse {
  B: string;
  salt: string;
}

interface LoginFinishResponse {
  sessionToken: string;
  serverProof: string;
  emailVerified: boolean;
}

interface KeysExportResponse {
  data: {
    x25519EncryptedPrivateKey: string;
  };
}

// ---------------------------------------------------------------------------
// LoginForm
// ---------------------------------------------------------------------------

const LoginForm = () => {
  const [email, setEmail] = React.useState('');
  const [passphrase, setPassphrase] = React.useState('');
  const [showPassphrase, setShowPassphrase] = React.useState(false);
  const [status, setStatus] = React.useState<'idle' | 'signing-in' | 'unlocking-keys' | 'error'>(
    'idle',
  );
  const [errorMessage, setErrorMessage] = React.useState('');

  const isLoading = status === 'signing-in' || status === 'unlocking-keys';
  const canSubmit = email.length > 0 && passphrase.length > 0 && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus('signing-in');
    setErrorMessage('');

    const base = getApiBaseUrl();

    try {
      // Dynamic import for bundle splitting
      const { srpGenerateEphemeral, srpDeriveSession } = await import('@enclave/crypto');

      // Step 1: Generate ephemeral and start login
      const clientEphemeral = srpGenerateEphemeral();

      const startResp = await fetch(`${base}/auth/login/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, A: clientEphemeral.public }),
      });

      if (!startResp.ok) {
        throw new Error('AUTH_FAILED');
      }

      const { B, salt } = (await startResp.json()) as LoginStartResponse;

      // Step 2: Derive session and finish login
      const clientSession = srpDeriveSession(clientEphemeral, B, salt, email, passphrase);

      const finishResp = await fetch(`${base}/auth/login/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, clientProof: clientSession.proof }),
      });

      if (!finishResp.ok) {
        throw new Error('AUTH_FAILED');
      }

      const { sessionToken, emailVerified } = (await finishResp.json()) as LoginFinishResponse;

      setStatus('unlocking-keys');

      // Store session token, user context, and SRP salt for unlock-on-refresh
      try {
        localStorage.setItem('enclave:sessionToken', sessionToken);
        localStorage.setItem('enclave:userEmail', email);
        localStorage.setItem('enclave:srpSalt', salt);
        localStorage.setItem('enclave:emailVerified', String(emailVerified));
      } catch {
        // Storage may be unavailable
      }

      clearInMemorySessionSecrets();

      const sessionKey = await deriveSessionKeyFromPassphrase(passphrase, salt);
      window.__enclave_session_key = sessionKey;

      // Best-effort: load and decrypt long-term X25519 private key for inbox decryption paths.
      try {
        const keysExportResp = await fetch(`${base}/keys/export`, {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });

        if (keysExportResp.ok) {
          const keysExportJson = (await keysExportResp.json()) as KeysExportResponse;
          const x25519PrivateKey = await decryptX25519PrivateKeyFromExportBlob(
            keysExportJson.data.x25519EncryptedPrivateKey,
            passphrase,
          );
          window.__enclave_x25519_private_key = x25519PrivateKey;
        }
      } catch {
        // Non-fatal: user can still proceed with session-key decryption only.
      }

      // Redirect to inbox
      window.location.href = '/mail/inbox';
    } catch {
      clearInMemorySessionSecrets();
      setErrorMessage('Sign in failed or keys could not be unlocked. Please try again.');
      setStatus('error');
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="rounded-sm border border-border bg-surface p-8">
        {/* Logo */}
        <div className="mb-6 flex items-center justify-center gap-1.5">
          <span className="font-mono text-ui-lg font-semibold text-primary" aria-hidden="true">
            &oplus;
          </span>
          <span className="font-mono text-ui-md font-semibold tracking-wide text-text-primary">
            Enclave Mail
          </span>
        </div>

        <h1 className="mb-6 text-center text-ui-md font-semibold text-text-primary">Sign In</h1>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-email" className="text-ui-xs text-text-secondary">
              Email address
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Passphrase */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-passphrase" className="text-ui-xs text-text-secondary">
              Passphrase
            </label>
            <div className="relative">
              <Input
                id="login-passphrase"
                type={showPassphrase ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="pr-8"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-fast"
                onClick={() => setShowPassphrase((v) => !v)}
                aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                tabIndex={-1}
              >
                <HugeiconsIcon
                  icon={(showPassphrase ? ViewOffIcon : ViewIcon) as IconSvgElement}
                  size={16}
                  strokeWidth={1.5}
                />
              </button>
            </div>
          </div>

          {/* Error */}
          {status === 'error' && (
            <div className="rounded-sm border border-danger/30 bg-danger/10 p-3">
              <p className="text-ui-xs text-danger">{errorMessage}</p>
            </div>
          )}

          {/* Submit */}
          <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                {status === 'unlocking-keys' ? 'Unlocking your keys…' : 'Signing in…'}
              </span>
            ) : (
              'Sign In'
            )}
          </Button>

          {/* Register link */}
          <p className="text-center text-ui-xs text-text-secondary">
            Don&apos;t have an account?{' '}
            <a href="/onboarding" className="text-primary hover:underline">
              Create an account
            </a>
          </p>
        </form>
      </div>
    </div>
  );
};

export { LoginForm };
