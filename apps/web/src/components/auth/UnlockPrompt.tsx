import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@enclave/ui';
import { LockIcon } from '@hugeicons/core-free-icons';
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

interface KeysExportResponse {
  data: {
    x25519EncryptedPrivateKey: string;
  };
}

// ---------------------------------------------------------------------------
// UnlockPrompt
// ---------------------------------------------------------------------------

interface UnlockPromptProps {
  onUnlocked: () => void;
  onCancel: () => void;
}

const UnlockPrompt = ({ onUnlocked, onCancel }: UnlockPromptProps) => {
  const [passphrase, setPassphrase] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Focus the passphrase input when the dialog opens
  React.useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase || isLoading) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const salt = localStorage.getItem('enclave:srpSalt');
      if (!salt) {
        // No salt available — cannot derive key, redirect to login
        onCancel();
        return;
      }

      clearInMemorySessionSecrets();

      const sessionKey = await deriveSessionKeyFromPassphrase(passphrase, salt);
      window.__enclave_session_key = sessionKey;

      // Best-effort: restore X25519 private key for inbox decryption
      try {
        const sessionToken = localStorage.getItem('enclave:sessionToken');
        if (sessionToken) {
          const base = getApiBaseUrl();
          const keysExportResp = await fetch(`${base}/keys/export`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          });

          if (keysExportResp.ok) {
            const keysExportJson = (await keysExportResp.json()) as KeysExportResponse;
            const x25519PrivateKey = await decryptX25519PrivateKeyFromExportBlob(
              keysExportJson.data.x25519EncryptedPrivateKey,
              passphrase,
            );
            window.__enclave_x25519_private_key = x25519PrivateKey;
          }
        }
      } catch {
        // Non-fatal: user can still proceed with session-key decryption only.
      }

      onUnlocked();
    } catch {
      setError('Incorrect passphrase. Try again.');
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    clearInMemorySessionSecrets();
    onCancel();
  };

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-sm"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={LockIcon as IconSvgElement}
              size={18}
              strokeWidth={1.5}
              className="text-primary"
            />
            <DialogTitle>Unlock your keys</DialogTitle>
          </div>
          <DialogDescription>
            Your session is still active. Enter your passphrase to unlock your encryption keys.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="unlock-passphrase" className="text-ui-xs text-text-secondary">
              Passphrase
            </label>
            <Input
              ref={inputRef}
              id="unlock-passphrase"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={isLoading}
              aria-describedby={error ? 'unlock-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
          </div>

          {error && (
            <div
              id="unlock-error"
              role="alert"
              className="rounded-sm border border-danger/30 bg-danger/10 p-3"
            >
              <p className="text-ui-xs text-danger">{error}</p>
            </div>
          )}

          <DialogFooter className="border-t-0 p-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isLoading}
            >
              Sign out
            </Button>
            <Button type="submit" size="sm" disabled={!passphrase || isLoading}>
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background border-t-transparent" />
                  Unlocking…
                </span>
              ) : (
                'Unlock'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export { UnlockPrompt };
export type { UnlockPromptProps };
