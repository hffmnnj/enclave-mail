import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Separator,
  cn,
} from '@enclave/ui';
import {
  CheckmarkCircle01Icon,
  Contact01Icon,
  Key01Icon,
  LockIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { getQueryClient } from '../../lib/query-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserPreferences {
  displayName?: string;
  signature?: string;
  theme: 'dark' | 'light' | 'system';
  notificationsEnabled: boolean;
  autoMarkRead: boolean;
  messagesPerPage: number;
}

interface KeyExportResponse {
  data: {
    x25519PublicKey: string;
    x25519EncryptedPrivateKey: string;
    ed25519PublicKey: string;
    ed25519EncryptedPrivateKey: string;
  };
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

const fetchSettings = async (): Promise<UserPreferences> => {
  const res = await fetch(`${getApiBaseUrl()}/settings`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load settings');
  const json = (await res.json()) as { data: UserPreferences };
  return json.data;
};

const updateSettings = async (updates: Partial<UserPreferences>): Promise<UserPreferences> => {
  const res = await fetch(`${getApiBaseUrl()}/settings`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to save settings');
  const json = (await res.json()) as { data: UserPreferences };
  return json.data;
};

const fetchEncryptedKeys = async (): Promise<KeyExportResponse['data']> => {
  const res = await fetch(`${getApiBaseUrl()}/keys/export`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch encrypted keys');
  const json = (await res.json()) as KeyExportResponse;
  return json.data;
};

const rotateKeys = async (body: {
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
// Passphrase strength
// ---------------------------------------------------------------------------

type StrengthLevel = 'weak' | 'fair' | 'strong' | 'very strong';

interface StrengthInfo {
  level: StrengthLevel;
  color: string;
  width: string;
}

const getPassphraseStrength = (passphrase: string): StrengthInfo => {
  const len = passphrase.length;
  if (len >= 20) return { level: 'very strong', color: 'bg-success', width: 'w-full' };
  if (len >= 12) return { level: 'strong', color: 'bg-success', width: 'w-3/4' };
  if (len >= 8) return { level: 'fair', color: 'bg-secondary', width: 'w-1/2' };
  return { level: 'weak', color: 'bg-danger', width: 'w-1/4' };
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

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

// ---------------------------------------------------------------------------
// Feedback message component
// ---------------------------------------------------------------------------

interface FeedbackProps {
  type: 'success' | 'error';
  message: string;
}

const Feedback = ({ type, message }: FeedbackProps) => (
  <p
    className={cn('text-ui-xs mt-1.5', type === 'success' ? 'text-success' : 'text-danger')}
    role={type === 'error' ? 'alert' : 'status'}
  >
    {message}
  </p>
);

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

interface ProfileSectionProps {
  settings: UserPreferences;
}

const ProfileSection = ({ settings }: ProfileSectionProps) => {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = React.useState(settings.displayName ?? '');
  const [signature, setSignature] = React.useState(settings.signature ?? '');
  const [feedback, setFeedback] = React.useState<FeedbackProps | null>(null);

  const userEmail = React.useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('enclave:userEmail') ?? '';
    } catch {
      return '';
    }
  }, []);

  React.useEffect(() => {
    setDisplayName(settings.displayName ?? '');
    setSignature(settings.signature ?? '');
  }, [settings.displayName, settings.signature]);

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      setFeedback({ type: 'success', message: 'Profile saved.' });
    },
    onError: (err: Error) => {
      setFeedback({ type: 'error', message: err.message });
    },
  });

  React.useEffect(() => {
    if (feedback?.type === 'success') {
      const t = setTimeout(() => setFeedback(null), 3000);
      return () => clearTimeout(t);
    }
  }, [feedback]);

  const handleSave = () => {
    setFeedback(null);
    mutation.mutate({ displayName: displayName.trim(), signature: signature.trim() });
  };

  const isDirty =
    displayName.trim() !== (settings.displayName ?? '') ||
    signature.trim() !== (settings.signature ?? '');

  return (
    <div className="space-y-3">
      <h3 className="text-ui-sm font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
        <HugeiconsIcon icon={Contact01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
        Profile
      </h3>

      <div className="space-y-2.5">
        <div>
          <label htmlFor="display-name" className="block text-ui-xs text-text-secondary mb-1">
            Display name
          </label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="max-w-sm"
          />
        </div>

        <div>
          <label htmlFor="email-display" className="block text-ui-xs text-text-secondary mb-1">
            Email
          </label>
          <Input
            id="email-display"
            value={userEmail}
            readOnly
            disabled
            className="max-w-sm font-mono text-ui-xs"
          />
        </div>

        <div>
          <label htmlFor="signature" className="block text-ui-xs text-text-secondary mb-1">
            Email signature
          </label>
          <textarea
            id="signature"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="Your email signature..."
            rows={3}
            className={cn(
              'flex w-full max-w-sm rounded border border-border bg-surface px-2 py-1.5 text-ui-base text-text-primary',
              'placeholder:text-text-secondary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'transition-colors duration-default resize-none',
            )}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/80 text-background"
            disabled={!isDirty || mutation.isPending}
            onClick={handleSave}
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </Button>
          {feedback && <Feedback type={feedback.type} message={feedback.message} />}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Change passphrase section
// ---------------------------------------------------------------------------

type PassphraseStep = 'idle' | 'processing' | 'success' | 'error';

const ChangePassphraseSection = () => {
  const [currentPassphrase, setCurrentPassphrase] = React.useState('');
  const [newPassphrase, setNewPassphrase] = React.useState('');
  const [confirmPassphrase, setConfirmPassphrase] = React.useState('');
  const [step, setStep] = React.useState<PassphraseStep>('idle');
  const [progressMessage, setProgressMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);

  const strength = React.useMemo(() => getPassphraseStrength(newPassphrase), [newPassphrase]);

  const validationError = React.useMemo(() => {
    if (newPassphrase.length > 0 && newPassphrase.length < 8) {
      return 'Passphrase must be at least 8 characters.';
    }
    if (confirmPassphrase.length > 0 && newPassphrase !== confirmPassphrase) {
      return 'Passphrases do not match.';
    }
    return null;
  }, [newPassphrase, confirmPassphrase]);

  const canSubmit =
    step === 'idle' &&
    currentPassphrase.length > 0 &&
    newPassphrase.length >= 8 &&
    newPassphrase === confirmPassphrase &&
    !validationError;

  const resetForm = () => {
    setCurrentPassphrase('');
    setNewPassphrase('');
    setConfirmPassphrase('');
    setShowCurrent(false);
    setShowNew(false);
  };

  const handleChangePassphrase = async () => {
    if (!canSubmit) return;

    setStep('processing');
    setErrorMessage('');

    try {
      // Step 1: Fetch encrypted keys from server
      setProgressMessage('Fetching encrypted keys...');
      const keys = await fetchEncryptedKeys();

      // Step 2: Decode encrypted private keys (base64 → Uint8Array)
      setProgressMessage('Decrypting private keys...');
      const x25519EncBlob = base64ToBytes(keys.x25519EncryptedPrivateKey);
      const ed25519EncBlob = base64ToBytes(keys.ed25519EncryptedPrivateKey);

      // Step 3: Decrypt with old passphrase
      // The stored blob format is: [salt (16B) | nonce (12B) | ciphertext | tag (16B)]
      // Use decryptPrivateKeyWithPassphrase which handles salt extraction internally
      const { decryptPrivateKeyWithPassphrase, encryptPrivateKeyWithPassphrase } = await import(
        '@enclave/crypto'
      );

      const x25519PrivateKey = await decryptPrivateKeyWithPassphrase(
        x25519EncBlob,
        currentPassphrase,
      );
      const ed25519PrivateKey = await decryptPrivateKeyWithPassphrase(
        ed25519EncBlob,
        currentPassphrase,
      );

      // Step 4: Re-encrypt with new passphrase (generates new salt internally)
      setProgressMessage('Re-encrypting with new passphrase...');
      const newX25519EncBlob = await encryptPrivateKeyWithPassphrase(
        x25519PrivateKey,
        newPassphrase,
      );
      const newEd25519EncBlob = await encryptPrivateKeyWithPassphrase(
        ed25519PrivateKey,
        newPassphrase,
      );

      // Step 5: Upload re-encrypted keys
      setProgressMessage('Uploading re-encrypted keys...');
      await rotateKeys({
        x25519PublicKey: keys.x25519PublicKey,
        x25519EncryptedPrivateKey: bytesToBase64(newX25519EncBlob),
        ed25519PublicKey: keys.ed25519PublicKey,
        ed25519EncryptedPrivateKey: bytesToBase64(newEd25519EncBlob),
      });

      setStep('success');
      setProgressMessage('');
      resetForm();
    } catch (err) {
      setStep('error');
      setProgressMessage('');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to change passphrase. Please verify your current passphrase.',
      );
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-ui-sm font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
        <HugeiconsIcon icon={Key01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
        Change Passphrase
      </h3>

      <div className="rounded-sm border border-border bg-surface-raised/30 px-3 py-2">
        <div className="flex items-start gap-2">
          <HugeiconsIcon
            icon={LockIcon as IconSvgElement}
            size={14}
            strokeWidth={1.5}
            className="mt-0.5 shrink-0 text-primary"
          />
          <p className="text-ui-xs text-text-secondary leading-relaxed">
            All passphrase operations happen client-side — your passphrase never leaves this device.
            Changing your passphrase re-encrypts your private keys locally and uploads only the
            encrypted result.
          </p>
        </div>
      </div>

      {/* Processing overlay */}
      {step === 'processing' && (
        <div className="rounded-sm border border-primary/30 bg-primary/5 px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-ui-xs text-primary font-medium">{progressMessage}</span>
          </div>
          <p className="mt-1.5 text-ui-xs text-text-secondary">
            Do not close this page while the operation is in progress.
          </p>
        </div>
      )}

      {/* Success message */}
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
              Passphrase changed successfully.
            </span>
          </div>
          <p className="mt-1.5 text-ui-xs text-text-secondary">
            Please export your keys again to keep your backup current.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-ui-xs"
            onClick={() => setStep('idle')}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Error message */}
      {step === 'error' && (
        <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2.5">
          <p className="text-ui-xs text-danger">{errorMessage}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-ui-xs"
            onClick={() => setStep('idle')}
          >
            Try again
          </Button>
        </div>
      )}

      {/* Form fields */}
      {(step === 'idle' || step === 'error') && (
        <div className="space-y-2.5">
          <div>
            <label
              htmlFor="current-passphrase"
              className="block text-ui-xs text-text-secondary mb-1"
            >
              Current passphrase
            </label>
            <div className="relative max-w-sm">
              <Input
                id="current-passphrase"
                type={showCurrent ? 'text' : 'password'}
                value={currentPassphrase}
                onChange={(e) => setCurrentPassphrase(e.target.value)}
                placeholder="Enter current passphrase"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-fast"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? 'Hide passphrase' : 'Show passphrase'}
              >
                <span className="text-ui-xs font-mono">{showCurrent ? 'hide' : 'show'}</span>
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="new-passphrase" className="block text-ui-xs text-text-secondary mb-1">
              New passphrase
            </label>
            <div className="relative max-w-sm">
              <Input
                id="new-passphrase"
                type={showNew ? 'text' : 'password'}
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                placeholder="Enter new passphrase"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-fast"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Hide passphrase' : 'Show passphrase'}
              >
                <span className="text-ui-xs font-mono">{showNew ? 'hide' : 'show'}</span>
              </button>
            </div>
            {/* Strength indicator */}
            {newPassphrase.length > 0 && (
              <div className="mt-1.5 max-w-sm">
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
                    'text-success': strength.level === 'strong' || strength.level === 'very strong',
                  })}
                >
                  {strength.level}
                </span>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="confirm-passphrase"
              className="block text-ui-xs text-text-secondary mb-1"
            >
              Confirm new passphrase
            </label>
            <Input
              id="confirm-passphrase"
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              placeholder="Confirm new passphrase"
              autoComplete="new-password"
              className="max-w-sm"
            />
          </div>

          {validationError && <p className="text-ui-xs text-danger">{validationError}</p>}

          <Button
            size="sm"
            className="bg-primary hover:bg-primary/80 text-background"
            disabled={!canSubmit}
            onClick={() => void handleChangePassphrase()}
          >
            Change Passphrase
          </Button>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inner component (requires QueryClientProvider ancestor)
// ---------------------------------------------------------------------------

const AccountSettingsInner = () => {
  const {
    data: settings,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  if (isLoading) {
    return (
      <Card className="bg-surface border-border rounded-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-ui-base font-semibold text-text-primary">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-border" />
            <div className="h-7 w-64 animate-pulse rounded bg-border" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-16 animate-pulse rounded bg-border" />
            <div className="h-7 w-64 animate-pulse rounded bg-border" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="bg-surface border-border rounded-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-ui-base font-semibold text-text-primary">Account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-ui-xs text-danger">
            {error instanceof Error ? error.message : 'Failed to load account settings.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!settings) return null;

  return (
    <Card className="bg-surface border-border rounded-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-ui-base font-semibold text-text-primary">Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ProfileSection settings={settings} />
        <Separator />
        <ChangePassphraseSection />
      </CardContent>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Public component — wraps with QueryClientProvider for React island isolation
// ---------------------------------------------------------------------------

const AccountSettings = () => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AccountSettingsInner />
    </QueryClientProvider>
  );
};

export { AccountSettings };
