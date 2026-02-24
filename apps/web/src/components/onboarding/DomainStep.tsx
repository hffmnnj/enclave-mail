import { Button, Input } from '@enclave/ui';
import * as React from 'react';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const getApiBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) {
    return import.meta.env.PUBLIC_API_URL as string;
  }
  return 'http://localhost:3001';
};

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

interface SaveDomainResponse {
  success: boolean;
  domain: string;
}

// ---------------------------------------------------------------------------
// DomainStep
// ---------------------------------------------------------------------------

interface DomainStepProps {
  onNext: (domain: string) => void;
}

const DomainStep = ({ onNext }: DomainStepProps) => {
  const [domain, setDomain] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = React.useState('');

  const trimmed = domain.trim().toLowerCase();
  const isEmpty = trimmed.length === 0;
  const isTooShort = trimmed.length > 0 && trimmed.length < 4;
  const isInvalidFormat = trimmed.length >= 4 && !DOMAIN_REGEX.test(trimmed);
  const isValid = !isEmpty && !isTooShort && !isInvalidFormat;

  const validationError = touched
    ? isEmpty
      ? 'Domain is required'
      : isTooShort
        ? 'Domain must be at least 4 characters'
        : isInvalidFormat
          ? 'Enter a valid domain (e.g. example.com)'
          : null
    : null;

  const canSubmit = isValid && status !== 'loading';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (!isValid) return;

    setStatus('loading');
    setErrorMessage('');

    const base = getApiBaseUrl();

    try {
      const resp = await fetch(`${base}/setup/domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: trimmed }),
      });

      if (!resp.ok) {
        throw new Error(`Server responded with ${String(resp.status)}`);
      }

      const data = (await resp.json()) as SaveDomainResponse;

      if (data.success) {
        onNext(data.domain);
      } else {
        throw new Error('Domain save was not successful');
      }
    } catch {
      setErrorMessage('Failed to save domain. Please try again.');
      setStatus('error');
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-ui-lg font-medium text-text-primary">Configure Your Domain</h2>
        <p className="text-ui-sm text-text-secondary">
          Enter the domain you'll use for your mail server.
        </p>
      </div>

      {/* Domain input */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="onboard-domain" className="text-ui-xs text-text-secondary">
          Mail Domain
        </label>
        <Input
          id="onboard-domain"
          type="text"
          autoComplete="off"
          placeholder="example.com"
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value);
            if (status === 'error') {
              setStatus('idle');
              setErrorMessage('');
            }
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={
            validationError ? 'domain-error' : errorMessage ? 'domain-api-error' : undefined
          }
        />
        {validationError && (
          <p id="domain-error" className="text-ui-xs text-danger" role="alert">
            {validationError}
          </p>
        )}
      </div>

      {/* API error */}
      {status === 'error' && errorMessage && (
        <div className="rounded-sm border border-danger/30 bg-danger/10 p-3">
          <p id="domain-api-error" className="text-ui-xs text-danger" role="alert">
            {errorMessage}
          </p>
        </div>
      )}

      {/* Submit */}
      <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
        {status === 'loading' ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
            Saving…
          </span>
        ) : (
          'Continue'
        )}
      </Button>
    </form>
  );
};

export { DomainStep };
export type { DomainStepProps };
