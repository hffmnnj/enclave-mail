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
import { CheckmarkCircle01Icon, Download02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeyExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ExportStep = 'passphrase' | 'processing' | 'success' | 'error';

interface ExportedKeys {
  x25519PublicKey: string;
  x25519EncryptedPrivateKey: string;
  ed25519PublicKey: string;
  ed25519EncryptedPrivateKey: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const getApiBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) {
    return import.meta.env.PUBLIC_API_URL as string;
  }
  return 'http://localhost:3001';
};

const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('enclave:sessionToken');
  } catch {
    return null;
  }
};

const authHeaders = (): HeadersInit => {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const fetchEncryptedKeys = async (): Promise<ExportedKeys> => {
  const res = await fetch(`${getApiBaseUrl()}/keys/export`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch encrypted keys');
  const json = (await res.json()) as { data: ExportedKeys };
  return json.data;
};

const confirmKeyExport = async (): Promise<void> => {
  await fetch(`${getApiBaseUrl()}/account/confirm-key-export`, {
    method: 'POST',
    headers: authHeaders(),
  });
};

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

const base64ToBytes = (b64: string): Uint8Array => {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
};

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

const triggerDownload = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// KeyExportDialog
// ---------------------------------------------------------------------------

const KeyExportDialog = ({ open, onOpenChange }: KeyExportDialogProps) => {
  const [step, setStep] = React.useState<ExportStep>('passphrase');
  const [passphrase, setPassphrase] = React.useState('');
  const [progressMessage, setProgressMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');

  const resetState = React.useCallback(() => {
    setStep('passphrase');
    setPassphrase('');
    setProgressMessage('');
    setErrorMessage('');
  }, []);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetState();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetState],
  );

  const handleExport = async () => {
    if (!passphrase) return;

    setStep('processing');
    setErrorMessage('');

    try {
      setProgressMessage('Fetching encrypted keys...');
      const keys = await fetchEncryptedKeys();

      setProgressMessage('Decrypting private keys...');
      const { decryptPrivateKeyWithPassphrase, exportKeyBundle } = await import('@enclave/crypto');

      const x25519EncBlob = base64ToBytes(keys.x25519EncryptedPrivateKey);
      const ed25519EncBlob = base64ToBytes(keys.ed25519EncryptedPrivateKey);

      const x25519PublicBytes = base64ToBytes(keys.x25519PublicKey);
      const ed25519PublicBytes = base64ToBytes(keys.ed25519PublicKey);

      const [x25519PrivateKey, ed25519PrivateKey] = await Promise.all([
        decryptPrivateKeyWithPassphrase(x25519EncBlob, passphrase),
        decryptPrivateKeyWithPassphrase(ed25519EncBlob, passphrase),
      ]);

      setProgressMessage('Generating key export file...');
      const bundleJson = await exportKeyBundle(
        {
          x25519: { publicKey: x25519PublicBytes, privateKey: x25519PrivateKey },
          ed25519: { publicKey: ed25519PublicBytes, privateKey: ed25519PrivateKey },
        },
        passphrase,
      );

      triggerDownload(bundleJson, 'enclave-keys.json');

      // Clear passphrase from memory immediately after use
      setPassphrase('');

      setProgressMessage('Confirming export...');
      await confirmKeyExport().catch(() => {
        // Non-critical — don't block success if confirm fails
      });

      setStep('success');
      setProgressMessage('');
    } catch (err) {
      setStep('error');
      setProgressMessage('');
      setPassphrase('');
      setErrorMessage(
        err instanceof Error && err.message.includes('decrypt')
          ? 'Incorrect passphrase. Please try again.'
          : err instanceof Error
            ? err.message
            : 'Failed to export keys. Please try again.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Download02Icon as IconSvgElement}
              size={18}
              strokeWidth={1.5}
              className="text-primary"
            />
            Export Encryption Keys
          </DialogTitle>
          <DialogDescription>
            Download a backup of your encryption keys. You will need your passphrase to generate the
            export file.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-3 space-y-3">
          {/* Passphrase step */}
          {(step === 'passphrase' || step === 'error') && (
            <div className="space-y-3">
              <p className="text-ui-sm text-text-secondary">
                Enter your passphrase to generate the key export file.
              </p>

              <div>
                <label
                  htmlFor="export-passphrase"
                  className="block text-ui-xs text-text-secondary mb-1"
                >
                  Passphrase
                </label>
                <Input
                  id="export-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter your passphrase"
                  autoComplete="current-password"
                  className="max-w-full"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && passphrase.length > 0) {
                      void handleExport();
                    }
                  }}
                />
              </div>

              {step === 'error' && (
                <div
                  className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2"
                  role="alert"
                >
                  <p className="text-ui-xs text-danger">{errorMessage}</p>
                </div>
              )}
            </div>
          )}

          {/* Processing step */}
          {step === 'processing' && (
            <div className="rounded-sm border border-primary/30 bg-primary/5 px-3 py-3">
              <div className="flex items-center gap-2">
                <div className="size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-ui-xs text-primary font-medium">{progressMessage}</span>
              </div>
              <p className="mt-1.5 text-ui-xs text-text-secondary">
                Do not close this dialog while the operation is in progress.
              </p>
            </div>
          )}

          {/* Success step */}
          {step === 'success' && (
            <div className="rounded-sm border border-success/30 bg-success/5 px-3 py-3">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={CheckmarkCircle01Icon as IconSvgElement}
                  size={16}
                  strokeWidth={1.5}
                  className="text-success"
                />
                <span className="text-ui-xs text-success font-medium">
                  Key file downloaded successfully.
                </span>
              </div>
              <p className="mt-1.5 text-ui-xs text-text-secondary">
                Store it safely — this is your only recovery option if you lose your passphrase.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {(step === 'passphrase' || step === 'error') && (
            <>
              <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/80 text-background"
                disabled={passphrase.length === 0}
                onClick={() => void handleExport()}
              >
                <HugeiconsIcon
                  icon={Download02Icon as IconSvgElement}
                  size={14}
                  strokeWidth={1.5}
                  className="mr-1.5"
                />
                Download Key File
              </Button>
            </>
          )}
          {step === 'success' && (
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/80 text-background"
              onClick={() => handleOpenChange(false)}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { KeyExportDialog };
export type { KeyExportDialogProps };
