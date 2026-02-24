import { Button } from '@enclave/ui';
import { Cancel01Icon, Tick01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DnsRecordStatus = 'pass' | 'fail' | 'not-found';

interface DnsCheckResult {
  mx: DnsRecordStatus;
  spf: DnsRecordStatus;
  dkim: DnsRecordStatus;
  dmarc: DnsRecordStatus;
  allPassed: boolean;
}

interface RecordCheckEntry {
  key: keyof Omit<DnsCheckResult, 'allPassed'>;
  label: string;
}

const RECORD_ENTRIES: RecordCheckEntry[] = [
  { key: 'mx', label: 'MX Record' },
  { key: 'spf', label: 'SPF Record' },
  { key: 'dkim', label: 'DKIM Record' },
  { key: 'dmarc', label: 'DMARC Record' },
];

// ---------------------------------------------------------------------------
// StatusIcon
// ---------------------------------------------------------------------------

interface StatusIconProps {
  recordStatus: DnsRecordStatus;
}

const StatusIcon = ({ recordStatus }: StatusIconProps) => {
  if (recordStatus === 'pass') {
    return (
      <HugeiconsIcon
        icon={Tick01Icon as IconSvgElement}
        size={16}
        strokeWidth={1.5}
        className="text-success"
      />
    );
  }

  return (
    <HugeiconsIcon
      icon={Cancel01Icon as IconSvgElement}
      size={16}
      strokeWidth={1.5}
      className="text-danger"
    />
  );
};

// ---------------------------------------------------------------------------
// StatusLabel
// ---------------------------------------------------------------------------

const statusLabelMap: Record<DnsRecordStatus, string> = {
  pass: 'Verified',
  fail: 'Failed',
  'not-found': 'Not found',
};

const statusColorMap: Record<DnsRecordStatus, string> = {
  pass: 'text-success',
  fail: 'text-danger',
  'not-found': 'text-danger',
};

// ---------------------------------------------------------------------------
// DnsVerificationStep
// ---------------------------------------------------------------------------

interface DnsVerificationStepProps {
  onNext: () => void;
}

const DnsVerificationStep = ({ onNext }: DnsVerificationStepProps) => {
  const [result, setResult] = React.useState<DnsCheckResult | null>(null);
  const [status, setStatus] = React.useState<'checking' | 'done' | 'error'>('checking');
  const [errorMessage, setErrorMessage] = React.useState('');
  const checkedRef = React.useRef(false);

  const runCheck = React.useCallback(async () => {
    setStatus('checking');
    setErrorMessage('');
    setResult(null);

    const base = getApiBaseUrl();

    try {
      const resp = await fetch(`${base}/setup/dns-check`, {
        method: 'POST',
      });

      if (!resp.ok) {
        throw new Error(`Server responded with ${String(resp.status)}`);
      }

      const data = (await resp.json()) as DnsCheckResult;
      setResult(data);
      setStatus('done');
    } catch {
      setErrorMessage('Failed to check DNS records. Please try again.');
      setStatus('error');
    }
  }, []);

  React.useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void runCheck();
  }, [runCheck]);

  const handleCheckAgain = () => {
    void runCheck();
  };

  const allPassed = result?.allPassed === true;
  const hasFailures = result !== null && !allPassed;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-ui-lg font-medium text-text-primary">Verify DNS Records</h2>
        <p className="text-ui-sm text-text-secondary">Checking if your DNS records are live…</p>
      </div>

      {/* Loading */}
      {status === 'checking' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-ui-xs text-text-secondary">Checking DNS records…</p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="rounded-sm border border-danger/30 bg-danger/10 p-3">
          <p className="text-ui-xs text-danger" role="alert">
            {errorMessage}
          </p>
        </div>
      )}

      {/* Results */}
      {status === 'done' && result !== null && (
        <div className="flex flex-col gap-3">
          {/* Per-record status */}
          <div className="rounded-sm border border-border bg-background p-3 space-y-2.5">
            {RECORD_ENTRIES.map((entry) => {
              const recordStatus = result[entry.key];
              return (
                <div key={entry.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon recordStatus={recordStatus} />
                    <span className="text-ui-sm text-text-primary">{entry.label}</span>
                  </div>
                  <span className={`text-ui-xs ${statusColorMap[recordStatus]}`}>
                    {statusLabelMap[recordStatus]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Warning banner */}
          {hasFailures && (
            <div className="rounded-sm border border-amber/30 bg-amber/10 p-3">
              <p className="text-ui-xs text-amber leading-relaxed">
                DNS records may not have propagated yet. This can take 24–48 hours. You can check
                again or skip and continue.
              </p>
            </div>
          )}

          {/* All passed banner */}
          {allPassed && (
            <div className="rounded-sm border border-success/30 bg-success/10 p-3">
              <p className="text-ui-xs text-success leading-relaxed">
                All DNS records verified successfully.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div className="flex flex-col gap-2">
        {allPassed ? (
          <Button type="button" size="lg" className="w-full" onClick={onNext}>
            Continue
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={handleCheckAgain}
              disabled={status === 'checking'}
            >
              {status === 'checking' ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                  Checking…
                </span>
              ) : (
                'Check again'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={onNext}
              disabled={status === 'checking'}
            >
              Skip and continue
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export { DnsVerificationStep };
export type { DnsVerificationStepProps };
