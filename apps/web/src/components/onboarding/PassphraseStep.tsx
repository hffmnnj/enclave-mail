import { Button, Input, cn } from '@enclave/ui';
import { ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Passphrase strength evaluation
// ---------------------------------------------------------------------------

type StrengthLevel = 'weak' | 'fair' | 'strong' | 'very-strong';

interface StrengthInfo {
  level: StrengthLevel;
  label: string;
  colorClass: string;
  barClass: string;
  percent: number;
}

const evaluateStrength = (passphrase: string): StrengthInfo => {
  const len = passphrase.length;

  if (len < 8) {
    return {
      level: 'weak',
      label: 'Weak',
      colorClass: 'text-danger',
      barClass: 'bg-danger',
      percent: 25,
    };
  }

  if (len < 12) {
    return {
      level: 'fair',
      label: 'Fair',
      colorClass: 'text-amber',
      barClass: 'bg-amber',
      percent: 50,
    };
  }

  if (len < 20) {
    return {
      level: 'strong',
      label: 'Strong',
      colorClass: 'text-success',
      barClass: 'bg-success',
      percent: 75,
    };
  }

  return {
    level: 'very-strong',
    label: 'Very strong',
    colorClass: 'text-success font-semibold',
    barClass: 'bg-success',
    percent: 100,
  };
};

const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// ---------------------------------------------------------------------------
// PassphraseStep
// ---------------------------------------------------------------------------

interface PassphraseStepProps {
  onNext: (email: string, passphrase: string) => void;
}

const PassphraseStep = ({ onNext }: PassphraseStepProps) => {
  const [email, setEmail] = React.useState('');
  const [passphrase, setPassphrase] = React.useState('');
  const [confirmPassphrase, setConfirmPassphrase] = React.useState('');
  const [showPassphrase, setShowPassphrase] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [touched, setTouched] = React.useState({
    email: false,
    passphrase: false,
    confirm: false,
  });

  const strength = evaluateStrength(passphrase);
  const emailValid = isValidEmail(email);
  const passphraseMatch = passphrase === confirmPassphrase;
  const strengthSufficient = strength.level !== 'weak';

  const canProceed = emailValid && passphrase.length > 0 && passphraseMatch && strengthSufficient;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canProceed) {
      onNext(email, passphrase);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="onboard-email" className="text-ui-xs text-text-secondary">
          Email address
        </label>
        <Input
          id="onboard-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          aria-invalid={touched.email && !emailValid ? true : undefined}
          aria-describedby={touched.email && !emailValid ? 'email-error' : undefined}
        />
        {touched.email && !emailValid && email.length > 0 && (
          <p id="email-error" className="text-ui-xs text-danger" role="alert">
            Enter a valid email address
          </p>
        )}
      </div>

      {/* Passphrase */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="onboard-passphrase" className="text-ui-xs text-text-secondary">
          Passphrase
        </label>
        <div className="relative">
          <Input
            id="onboard-passphrase"
            type={showPassphrase ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Enter a strong passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, passphrase: true }))}
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

        {/* Strength indicator */}
        {passphrase.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="h-1 w-full rounded-full bg-border overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-200', strength.barClass)}
                style={{ width: `${String(strength.percent)}%` }}
              />
            </div>
            <span className={cn('text-ui-xs', strength.colorClass)}>{strength.label}</span>
          </div>
        )}
        {touched.passphrase && passphrase.length > 0 && !strengthSufficient && (
          <p className="text-ui-xs text-danger" role="alert">
            Passphrase must be at least 8 characters
          </p>
        )}
      </div>

      {/* Confirm passphrase */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="onboard-confirm" className="text-ui-xs text-text-secondary">
          Confirm passphrase
        </label>
        <div className="relative">
          <Input
            id="onboard-confirm"
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Re-enter your passphrase"
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
            aria-invalid={touched.confirm && !passphraseMatch ? true : undefined}
            aria-describedby={touched.confirm && !passphraseMatch ? 'confirm-error' : undefined}
            className="pr-8"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-fast"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? 'Hide passphrase' : 'Show passphrase'}
            tabIndex={-1}
          >
            <HugeiconsIcon
              icon={(showConfirm ? ViewOffIcon : ViewIcon) as IconSvgElement}
              size={16}
              strokeWidth={1.5}
            />
          </button>
        </div>
        {touched.confirm && !passphraseMatch && confirmPassphrase.length > 0 && (
          <p id="confirm-error" className="text-ui-xs text-danger" role="alert">
            Passphrases do not match
          </p>
        )}
      </div>

      {/* Unrecoverable warning */}
      <div className="rounded-sm border border-danger/30 bg-danger/10 p-3">
        <p className="text-ui-xs text-danger leading-relaxed">
          <span className="font-semibold">⚠ This passphrase cannot be recovered.</span>
          <br />
          If you forget your passphrase, all your encrypted data will be permanently lost. There is
          no server-side reset or recovery mechanism.
        </p>
      </div>

      {/* Submit */}
      <Button type="submit" size="lg" disabled={!canProceed} className="w-full">
        Continue
      </Button>

      {/* Login link */}
      <p className="text-center text-ui-xs text-text-secondary">
        Already have an account?{' '}
        <a href="/login" className="text-primary hover:underline">
          Sign in
        </a>
      </p>
    </form>
  );
};

export { PassphraseStep };
export type { PassphraseStepProps };
