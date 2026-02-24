import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Separator,
  cn,
} from '@enclave/ui';
import {
  Alert01Icon,
  CheckmarkCircle01Icon,
  Download02Icon,
  Refresh01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeyRotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRotationComplete: () => void;
}

type RotationStep = 'warning' | 'passphrase' | 'generating' | 'export' | 'success' | 'error';

type StrengthLevel = 'weak' | 'fair' | 'strong' | 'very strong';

interface StrengthInfo {
  level: StrengthLevel;
  color: string;
  width: string;
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

const postRotateKeys = async (body: {
  x25519PublicKey: string;
  x25519EncryptedPrivateKey: string;
  ed25519PublicKey: string;
  ed25519EncryptedPrivateKey: string;
}): Promise<void> => {
  const res = await fetch(`${getApiBaseUrl()}/keys/rotate`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to rotate keys');
  }
};

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

// ---------------------------------------------------------------------------
// Passphrase strength
// ---------------------------------------------------------------------------

const getPassphraseStrength = (passphrase: string): StrengthInfo => {
  const len = passphrase.length;
  if (len >= 20) return { level: 'very strong', color: 'bg-success', width: 'w-full' };
  if (len >= 12) return { level: 'strong', color: 'bg-success', width: 'w-3/4' };
  if (len >= 8) return { level: 'fair', color: 'bg-secondary', width: 'w-1/2' };
  return { level: 'weak', color: 'bg-danger', width: 'w-1/4' };
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
// Fingerprint helper (first 8 bytes of SHA-256 of public key, as hex)
// ---------------------------------------------------------------------------

const computeFingerprint = async (publicKey: Uint8Array): Promise<string> => {
  const buffer = publicKey.buffer.slice(
    publicKey.byteOffset,
    publicKey.byteOffset + publicKey.byteLength,
  ) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
};

// ---------------------------------------------------------------------------
// KeyRotationDialog
// ---------------------------------------------------------------------------

interface GeneratedKeyData {
  x25519PublicKey: string;
  x25519EncryptedPrivateKey: string;
  ed25519PublicKey: string;
  ed25519EncryptedPrivateKey: string;
  bundleJson: string;
  x25519Fingerprint: string;
  ed25519Fingerprint: string;
}

const KeyRotationDialog = ({ open, onOpenChange, onRotationComplete }: KeyRotationDialogProps) => {
  const [step, setStep] = React.useState<RotationStep>('warning');
  const [passphrase, setPassphrase] = React.useState('');
  const [confirmPassphrase, setConfirmPassphrase] = React.useState('');
  const [showPassphrase, setShowPassphrase] = React.useState(false);
  const [progressMessage, setProgressMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [keyData, setKeyData] = React.useState<GeneratedKeyData | null>(null);
  const [hasDownloaded, setHasDownloaded] = React.useState(false);
  const [hasConfirmedBackup, setHasConfirmedBackup] = React.useState(false);

  const strength = React.useMemo(() => getPassphraseStrength(passphrase), [passphrase]);

  const validationError = React.useMemo(() => {
    if (passphrase.length > 0 && passphrase.length < 8) {
      return 'Passphrase must be at least 8 characters.';
    }
    if (confirmPassphrase.length > 0 && passphrase !== confirmPassphrase) {
      return 'Passphrases do not match.';
    }
    return null;
  }, [passphrase, confirmPassphrase]);

  const canGenerate =
    passphrase.length >= 8 && passphrase === confirmPassphrase && !validationError;

  const resetState = React.useCallback(() => {
    setStep('warning');
    setPassphrase('');
    setConfirmPassphrase('');
    setShowPassphrase(false);
    setProgressMessage('');
    setErrorMessage('');
    setKeyData(null);
    setHasDownloaded(false);
    setHasConfirmedBackup(false);
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

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setStep('generating');
    setErrorMessage('');

    try {
      setProgressMessage('Generating new encryption keys...');
      const {
        generateX25519KeyPair,
        generateEd25519KeyPair,
        encryptPrivateKeyWithPassphrase,
        exportKeyBundle,
      } = await import('@enclave/crypto');

      const x25519Pair = generateX25519KeyPair();
      const ed25519Pair = generateEd25519KeyPair();

      setProgressMessage('Encrypting private keys with your passphrase...');
      const [x25519EncBlob, ed25519EncBlob] = await Promise.all([
        encryptPrivateKeyWithPassphrase(x25519Pair.privateKey, passphrase),
        encryptPrivateKeyWithPassphrase(ed25519Pair.privateKey, passphrase),
      ]);

      setProgressMessage('Generating key export file...');
      const bundleJson = await exportKeyBundle(
        {
          x25519: { publicKey: x25519Pair.publicKey, privateKey: x25519Pair.privateKey },
          ed25519: { publicKey: ed25519Pair.publicKey, privateKey: ed25519Pair.privateKey },
        },
        passphrase,
      );

      const [x25519Fingerprint, ed25519Fingerprint] = await Promise.all([
        computeFingerprint(x25519Pair.publicKey),
        computeFingerprint(ed25519Pair.publicKey),
      ]);

      setKeyData({
        x25519PublicKey: bytesToBase64(x25519Pair.publicKey),
        x25519EncryptedPrivateKey: bytesToBase64(x25519EncBlob),
        ed25519PublicKey: bytesToBase64(ed25519Pair.publicKey),
        ed25519EncryptedPrivateKey: bytesToBase64(ed25519EncBlob),
        bundleJson,
        x25519Fingerprint,
        ed25519Fingerprint,
      });

      // Clear passphrase from state after crypto operations
      setPassphrase('');
      setConfirmPassphrase('');

      setStep('export');
      setProgressMessage('');
    } catch (err) {
      setStep('error');
      setProgressMessage('');
      setPassphrase('');
      setConfirmPassphrase('');
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to generate new keys. Please try again.',
      );
    }
  };

  const handleDownloadNewKeys = () => {
    if (!keyData) return;
    triggerDownload(keyData.bundleJson, 'enclave-keys.json');
    setHasDownloaded(true);
  };

  const handleCompleteRotation = async () => {
    if (!keyData || !hasConfirmedBackup) return;

    setStep('generating');
    setProgressMessage('Uploading new keys to server...');

    try {
      await postRotateKeys({
        x25519PublicKey: keyData.x25519PublicKey,
        x25519EncryptedPrivateKey: keyData.x25519EncryptedPrivateKey,
        ed25519PublicKey: keyData.ed25519PublicKey,
        ed25519EncryptedPrivateKey: keyData.ed25519EncryptedPrivateKey,
      });

      setStep('success');
      setProgressMessage('');
    } catch (err) {
      setStep('error');
      setProgressMessage('');
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to complete key rotation. Please try again.',
      );
    }
  };

  const handleSuccessClose = () => {
    handleOpenChange(false);
    onRotationComplete();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Refresh01Icon as IconSvgElement}
              size={18}
              strokeWidth={1.5}
              className="text-primary"
            />
            Rotate Encryption Keys
          </DialogTitle>
          {step === 'warning' && (
            <DialogDescription>
              Review the implications of key rotation before proceeding.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="px-4 py-3 space-y-3">
          {/* Warning step */}
          {step === 'warning' && (
            <div className="space-y-3">
              <div className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-3">
                <div className="flex items-start gap-2">
                  <HugeiconsIcon
                    icon={Alert01Icon as IconSvgElement}
                    size={16}
                    strokeWidth={1.5}
                    className="mt-0.5 shrink-0 text-danger"
                  />
                  <div className="space-y-2">
                    <p className="text-ui-sm font-medium text-danger">Key Rotation Warning</p>
                    <p className="text-ui-xs text-text-secondary leading-relaxed">
                      Rotating your keys will:
                    </p>
                    <ul className="text-ui-xs text-text-secondary leading-relaxed list-disc pl-4 space-y-1">
                      <li>Generate new encryption and signing keys</li>
                      <li>Deactivate your existing keys (kept for decrypting old messages)</li>
                      <li>Require you to export your new keys immediately</li>
                    </ul>
                    <p className="text-ui-xs text-text-secondary leading-relaxed">
                      Old encrypted messages will still be readable using your old keys until you
                      re-establish sessions.
                    </p>
                    <p className="text-ui-xs text-danger font-medium">
                      This action cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Passphrase step */}
          {step === 'passphrase' && (
            <div className="space-y-3">
              <p className="text-ui-sm text-text-secondary">
                Enter a passphrase to encrypt your new keys. This can be the same as your current
                passphrase or a new one.
              </p>

              <div>
                <label
                  htmlFor="rotation-passphrase"
                  className="block text-ui-xs text-text-secondary mb-1"
                >
                  Passphrase
                </label>
                <div className="relative">
                  <Input
                    id="rotation-passphrase"
                    type={showPassphrase ? 'text' : 'password'}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter passphrase"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-fast"
                    onClick={() => setShowPassphrase((v) => !v)}
                    aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                  >
                    <span className="text-ui-xs font-mono">{showPassphrase ? 'hide' : 'show'}</span>
                  </button>
                </div>
                {passphrase.length > 0 && (
                  <div className="mt-1.5">
                    <div className="h-1 w-full rounded-full bg-border overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          strength.color,
                          strength.width,
                        )}
                      />
                    </div>
                    <span
                      className={cn('text-ui-xs mt-0.5 block', {
                        'text-danger': strength.level === 'weak',
                        'text-secondary': strength.level === 'fair',
                        'text-success':
                          strength.level === 'strong' || strength.level === 'very strong',
                      })}
                    >
                      {strength.level}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="rotation-confirm-passphrase"
                  className="block text-ui-xs text-text-secondary mb-1"
                >
                  Confirm passphrase
                </label>
                <Input
                  id="rotation-confirm-passphrase"
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Confirm passphrase"
                  autoComplete="new-password"
                />
              </div>

              {validationError && (
                <p className="text-ui-xs text-danger" role="alert">
                  {validationError}
                </p>
              )}
            </div>
          )}

          {/* Generating step */}
          {step === 'generating' && (
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

          {/* Export step — mandatory download before completing rotation */}
          {step === 'export' && keyData && (
            <div className="space-y-3">
              <div className="rounded-sm border border-primary/30 bg-primary/5 px-3 py-2.5">
                <p className="text-ui-xs text-primary font-medium">
                  New keys generated successfully.
                </p>
                <p className="mt-1 text-ui-xs text-text-secondary">
                  You must download your new key backup before these keys are activated.
                </p>
              </div>

              <div className="space-y-2">
                <div className="rounded-sm border border-border bg-surface-raised/30 px-3 py-2">
                  <p className="text-ui-xs text-text-secondary mb-1">X25519 Encryption Key</p>
                  <p className="font-mono text-ui-xs text-primary">{keyData.x25519Fingerprint}</p>
                </div>
                <div className="rounded-sm border border-border bg-surface-raised/30 px-3 py-2">
                  <p className="text-ui-xs text-text-secondary mb-1">Ed25519 Signing Key</p>
                  <p className="font-mono text-ui-xs text-primary">{keyData.ed25519Fingerprint}</p>
                </div>
              </div>

              <Separator />

              <Button
                size="sm"
                className="w-full bg-primary hover:bg-primary/80 text-background"
                onClick={handleDownloadNewKeys}
              >
                <HugeiconsIcon
                  icon={Download02Icon as IconSvgElement}
                  size={14}
                  strokeWidth={1.5}
                  className="mr-1.5"
                />
                {hasDownloaded ? 'Download Again' : 'Download New Key File'}
              </Button>

              {hasDownloaded && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasConfirmedBackup}
                    onChange={(e) => setHasConfirmedBackup(e.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <span className="text-ui-xs text-text-secondary leading-relaxed">
                    I have saved my new key backup in a safe location
                  </span>
                </label>
              )}
            </div>
          )}

          {/* Error step */}
          {step === 'error' && (
            <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2.5">
              <p className="text-ui-xs text-danger">{errorMessage}</p>
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
                  Keys rotated successfully.
                </span>
              </div>
              <p className="mt-1.5 text-ui-xs text-text-secondary">
                Your new encryption keys are now active. Old messages remain readable with your
                previous keys.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'warning' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-danger hover:bg-danger/80 text-background"
                onClick={() => setStep('passphrase')}
              >
                I understand, continue
              </Button>
            </>
          )}

          {step === 'passphrase' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep('warning')}>
                Back
              </Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/80 text-background"
                disabled={!canGenerate}
                onClick={() => void handleGenerate()}
              >
                <HugeiconsIcon
                  icon={Refresh01Icon as IconSvgElement}
                  size={14}
                  strokeWidth={1.5}
                  className="mr-1.5"
                />
                Generate New Keys
              </Button>
            </>
          )}

          {step === 'export' && (
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/80 text-background"
              disabled={!hasConfirmedBackup}
              onClick={() => void handleCompleteRotation()}
            >
              Complete Rotation
            </Button>
          )}

          {step === 'error' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(keyData ? 'export' : 'passphrase')}
              >
                Try again
              </Button>
            </>
          )}

          {step === 'success' && (
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/80 text-background"
              onClick={handleSuccessClose}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { KeyRotationDialog };
export type { KeyRotationDialogProps };
