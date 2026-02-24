import { cn } from '@enclave/ui';
import * as React from 'react';

import type { RegistrationBundle } from '@enclave/crypto';

import { ConfirmStep } from './ConfirmStep.js';
import { KeyExportStep } from './KeyExportStep.js';
import { PassphraseStep } from './PassphraseStep.js';

// ---------------------------------------------------------------------------
// Wizard state
// ---------------------------------------------------------------------------

type WizardStep = 1 | 2 | 3 | 4;

const TOTAL_STEPS = 4;

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Credentials',
  2: 'Key Generation',
  3: 'Key Backup',
  4: 'Confirmation',
};

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  current: WizardStep;
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
  const [currentStep, setCurrentStep] = React.useState<WizardStep>(1);
  const [email, setEmail] = React.useState('');
  const [passphrase, setPassphrase] = React.useState('');
  const [registrationBundle, setRegistrationBundle] = React.useState<RegistrationBundle | null>(
    null,
  );
  const [keyGenError, setKeyGenError] = React.useState<string | null>(null);

  // Step 1 → Step 2
  const handlePassphraseNext = React.useCallback((newEmail: string, newPassphrase: string) => {
    setEmail(newEmail);
    setPassphrase(newPassphrase);
    setKeyGenError(null);
    setCurrentStep(2);
  }, []);

  // Step 2 → Step 3
  const handleKeyGenComplete = React.useCallback((bundle: RegistrationBundle) => {
    setRegistrationBundle(bundle);
    setCurrentStep(3);
  }, []);

  // Step 2 error
  const handleKeyGenError = React.useCallback((message: string) => {
    setKeyGenError(message);
  }, []);

  // Step 2 retry
  const handleRetry = () => {
    setKeyGenError(null);
    setCurrentStep(1);
  };

  // Step 3 → Step 4
  const handleKeyExportNext = React.useCallback(() => {
    setCurrentStep(4);
  }, []);

  // Step 4 → redirect
  const handleComplete = React.useCallback(() => {
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
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-ui-xs text-text-secondary">
              Step {currentStep} of {TOTAL_STEPS}
            </span>
            <span className="text-ui-xs text-text-secondary">{STEP_LABELS[currentStep]}</span>
          </div>
          <ProgressBar current={currentStep} total={TOTAL_STEPS} />
        </div>

        {/* Step content */}
        {currentStep === 1 && <PassphraseStep onNext={handlePassphraseNext} />}

        {currentStep === 2 && keyGenError === null && (
          <KeyGenStep
            email={email}
            passphrase={passphrase}
            onComplete={handleKeyGenComplete}
            onError={handleKeyGenError}
          />
        )}

        {currentStep === 2 && keyGenError !== null && (
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

        {currentStep === 3 && registrationBundle !== null && (
          <KeyExportStep
            keyExportBundle={registrationBundle.keyExportBundle}
            onNext={handleKeyExportNext}
          />
        )}

        {currentStep === 4 && registrationBundle !== null && (
          <ConfirmStep
            email={email}
            passphrase={passphrase}
            registrationBundle={registrationBundle}
            onComplete={handleComplete}
          />
        )}
      </div>
    </div>
  );
};

export { OnboardingWizard };
