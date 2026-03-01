import { cn } from '@enclave/ui';
import * as React from 'react';

import type { RegistrationBundle } from '@enclave/crypto';

import { deriveSessionKeyFromPassphrase } from '../../lib/crypto-client.js';

import { ConfirmStep } from './ConfirmStep.js';
import { DnsRecordsStep } from './DnsRecordsStep.js';
import { DnsVerificationStep } from './DnsVerificationStep.js';
import { DomainStep } from './DomainStep.js';
import { FirewallStep } from './FirewallStep.js';
import { KeyExportStep } from './KeyExportStep.js';
import { PassphraseStep } from './PassphraseStep.js';
import { RegistrationToggleStep } from './RegistrationToggleStep.js';
import { TlsStep } from './TlsStep.js';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const getApiBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) {
    return import.meta.env.PUBLIC_API_URL as string;
  }
  return 'http://localhost:3001';
};

interface SetupStatusResponse {
  hasUsers: boolean;
  isSetupComplete: boolean;
}

// ---------------------------------------------------------------------------
// Step configuration
// ---------------------------------------------------------------------------

const FRESH_STEP_LABELS: Record<number, string> = {
  1: 'Domain',
  2: 'DNS Records',
  3: 'DNS Verify',
  4: 'Firewall',
  5: 'TLS/SSL',
  6: 'Credentials',
  7: 'Key Generation',
  8: 'Key Backup',
  9: 'Confirmation',
  10: 'Registration',
};

const EXISTING_STEP_LABELS: Record<number, string> = {
  6: 'Credentials',
  7: 'Key Generation',
  8: 'Key Backup',
  9: 'Confirmation',
};

const FRESH_TOTAL_STEPS = 10;
const EXISTING_TOTAL_STEPS = 4;

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  current: number;
  total: number;
}

const ProgressBar = ({ current, total }: ProgressBarProps) => (
  <div className="flex gap-1">
    {Array.from({ length: total }, (_, i) => (
      <div
        key={`seg-${String(i)}`}
        className={cn(
          'h-1 flex-1 rounded-full transition-colors duration-200',
          i < current ? 'bg-primary' : 'bg-border',
        )}
      />
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Key generation step (inline — loading state)
// ---------------------------------------------------------------------------

interface KeyGenStepProps {
  email: string;
  passphrase: string;
  onComplete: (bundle: RegistrationBundle) => void;
  onError: (message: string) => void;
}

const KeyGenStep = ({ email, passphrase, onComplete, onError }: KeyGenStepProps) => {
  const [fingerprints, setFingerprints] = React.useState<{
    x25519: string;
    ed25519: string;
  } | null>(null);
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const generate = async () => {
      try {
        const { generateRegistrationBundle } = await import('@enclave/crypto');
        const bundle = await generateRegistrationBundle(email, passphrase);

        const truncate = (hex: string): string => `${hex.slice(0, 8)}…${hex.slice(-8)}`;

        setFingerprints({
          x25519: truncate(bundle.x25519PublicHex),
          ed25519: truncate(bundle.ed25519PublicHex),
        });

        // Brief pause to show fingerprints before advancing
        setTimeout(() => {
          onComplete(bundle);
        }, 800);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Key generation failed';
        onError(message);
      }
    };

    void generate();
  }, [email, passphrase, onComplete, onError]);

  return (
    <div className="flex flex-col items-center gap-5 py-8">
      {/* Spinner */}
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />

      <div className="text-center space-y-1">
        <p className="text-ui-base text-text-primary font-medium">
          Generating your encryption keys…
        </p>
        <p className="text-ui-xs text-text-secondary">
          This uses Argon2id key derivation and may take a few seconds.
        </p>
      </div>

      {/* Fingerprints — shown once generated */}
      {fingerprints !== null && (
        <div className="w-full rounded-sm border border-border bg-background p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-ui-xs text-text-secondary">X25519:</span>
            <span className="font-mono text-ui-xs text-text-secondary">{fingerprints.x25519}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-ui-xs text-text-secondary">Ed25519:</span>
            <span className="font-mono text-ui-xs text-text-secondary">{fingerprints.ed25519}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// OnboardingWizard
// ---------------------------------------------------------------------------

const OnboardingWizard = () => {
  // Setup detection
  const [setupStatus, setSetupStatus] = React.useState<'loading' | 'fresh' | 'existing'>('loading');

  // Wizard step navigation
  const [currentStep, setCurrentStep] = React.useState<number>(1);

  // Shared data
  const [, setDomain] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [passphrase, setPassphrase] = React.useState('');
  const [registrationBundle, setRegistrationBundle] = React.useState<RegistrationBundle | null>(
    null,
  );
  const [sessionToken, setSessionToken] = React.useState('');
  const [keyGenError, setKeyGenError] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);

  // Detect setup status on mount
  React.useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/setup/status`);
        const data = (await res.json()) as SetupStatusResponse;
        if (data.hasUsers) {
          setSetupStatus('existing');
          setCurrentStep(6);
        } else {
          setSetupStatus('fresh');
          setCurrentStep(1);
        }
      } catch {
        // Default to fresh if check fails
        setSetupStatus('fresh');
        setCurrentStep(1);
      }
    };
    void checkSetup();
  }, []);

  const isFreshInstall = setupStatus === 'fresh';
  const totalSteps = isFreshInstall ? FRESH_TOTAL_STEPS : EXISTING_TOTAL_STEPS;

  const getStepLabel = (step: number): string => {
    if (isFreshInstall) {
      return FRESH_STEP_LABELS[step] ?? '';
    }
    return EXISTING_STEP_LABELS[step] ?? '';
  };

  // For progress bar: normalize step number to a 1-based visual index
  const visualStep = isFreshInstall ? currentStep : currentStep - 5;

  // Step 6 → Step 7
  const handlePassphraseNext = React.useCallback((newEmail: string, newPassphrase: string) => {
    setEmail(newEmail);
    setPassphrase(newPassphrase);
    setKeyGenError(null);
    setConfirmError(null);
    setCurrentStep(7);
  }, []);

  // Step 7 → Step 8
  const handleKeyGenComplete = React.useCallback((bundle: RegistrationBundle) => {
    setRegistrationBundle(bundle);
    setConfirmError(null);
    setCurrentStep(8);
  }, []);

  // Step 7 error
  const handleKeyGenError = React.useCallback((message: string) => {
    setKeyGenError(message);
  }, []);

  // Step 7 retry → back to Step 6
  const handleRetry = () => {
    setKeyGenError(null);
    setCurrentStep(6);
  };

  // Step 8 → Step 9
  const handleKeyExportNext = React.useCallback(() => {
    setCurrentStep(9);
  }, []);

  // Step 9 → redirect (existing) or Step 10 (fresh)
  const handleConfirmComplete = React.useCallback(
    (token: string) => {
      void (async () => {
        if (!registrationBundle) {
          setConfirmError('Missing registration bundle. Please retry account creation.');
          return;
        }

        try {
          const sessionKey = await deriveSessionKeyFromPassphrase(
            passphrase,
            registrationBundle.salt,
          );
          window.__enclave_session_key = sessionKey;

          if (registrationBundle.x25519KeyPair.privateKey instanceof Uint8Array) {
            window.__enclave_x25519_private_key = registrationBundle.x25519KeyPair.privateKey;
          }

          try {
            localStorage.setItem('enclave:userEmail', email);
          } catch {
            // Storage may be unavailable
          }

          setConfirmError(null);

          if (isFreshInstall) {
            setSessionToken(token);
            setCurrentStep(10);
          } else {
            window.location.href = '/mail/inbox';
          }
        } catch {
          setConfirmError('Account created, but key unlock failed. Please retry sign in.');
        }
      })();
    },
    [email, isFreshInstall, passphrase, registrationBundle],
  );

  // Step 10 → redirect
  const handleRegistrationNext = React.useCallback(() => {
    window.location.href = '/mail/inbox';
  }, []);

  return (
    <div className="w-full max-w-md">
      {/* Card */}
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

        {/* Step indicator */}
        {setupStatus !== 'loading' && (
          <div className="mb-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-ui-xs text-text-secondary">
                Step {visualStep} of {totalSteps}
              </span>
              <span className="text-ui-xs text-text-secondary">{getStepLabel(currentStep)}</span>
            </div>
            <ProgressBar current={visualStep} total={totalSteps} />
          </div>
        )}

        {confirmError !== null && (
          <div className="mb-4 rounded-sm border border-danger/30 bg-danger/10 p-3">
            <p className="text-ui-xs text-danger">{confirmError}</p>
          </div>
        )}

        {/* Loading state */}
        {setupStatus === 'loading' && (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {/* Step content */}
        {setupStatus !== 'loading' && (
          <>
            {/* Step 1 — Domain (fresh only) */}
            {isFreshInstall && currentStep === 1 && (
              <DomainStep
                onNext={(d) => {
                  setDomain(d);
                  setCurrentStep(2);
                }}
              />
            )}

            {/* Step 2 — DNS Records (fresh only) */}
            {isFreshInstall && currentStep === 2 && (
              <DnsRecordsStep onNext={() => setCurrentStep(3)} />
            )}

            {/* Step 3 — DNS Verification (fresh only) */}
            {isFreshInstall && currentStep === 3 && (
              <DnsVerificationStep onNext={() => setCurrentStep(4)} />
            )}

            {/* Step 4 — Firewall (fresh only) */}
            {isFreshInstall && currentStep === 4 && (
              <FirewallStep onNext={() => setCurrentStep(5)} />
            )}

            {/* Step 5 — TLS/SSL (fresh only) */}
            {isFreshInstall && currentStep === 5 && <TlsStep onNext={() => setCurrentStep(6)} />}

            {/* Step 6 — Credentials */}
            {currentStep === 6 && <PassphraseStep onNext={handlePassphraseNext} />}

            {/* Step 7 — Key Generation */}
            {currentStep === 7 && keyGenError === null && (
              <KeyGenStep
                email={email}
                passphrase={passphrase}
                onComplete={handleKeyGenComplete}
                onError={handleKeyGenError}
              />
            )}

            {currentStep === 7 && keyGenError !== null && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="rounded-sm border border-danger/30 bg-danger/10 p-3 w-full">
                  <p className="text-ui-xs text-danger">{keyGenError}</p>
                </div>
                <button
                  type="button"
                  className="text-ui-sm text-primary hover:underline"
                  onClick={handleRetry}
                >
                  Try again
                </button>
              </div>
            )}

            {/* Step 8 — Key Backup */}
            {currentStep === 8 && registrationBundle !== null && (
              <KeyExportStep
                keyExportBundle={registrationBundle.keyExportBundle}
                onNext={handleKeyExportNext}
              />
            )}

            {/* Step 9 — Confirmation */}
            {currentStep === 9 && registrationBundle !== null && (
              <ConfirmStep
                email={email}
                passphrase={passphrase}
                registrationBundle={registrationBundle}
                onComplete={handleConfirmComplete}
              />
            )}

            {/* Step 10 — Registration Toggle (fresh only) */}
            {isFreshInstall && currentStep === 10 && (
              <RegistrationToggleStep sessionToken={sessionToken} onNext={handleRegistrationNext} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export { OnboardingWizard };
