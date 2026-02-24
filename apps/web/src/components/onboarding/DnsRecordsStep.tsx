import { Button } from '@enclave/ui';
import { Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons';
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

interface DnsRecord {
  type: 'MX' | 'TXT';
  host: string;
  value: string;
  priority?: number;
  label: string;
}

interface DnsRecordsResult {
  mx: DnsRecord;
  spf: DnsRecord;
  dkim: DnsRecord;
  dmarc: DnsRecord;
}

// ---------------------------------------------------------------------------
// Clipboard helper
// ---------------------------------------------------------------------------

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// RecordRow
// ---------------------------------------------------------------------------

interface RecordRowProps {
  record: DnsRecord;
}

const RecordRow = ({ record }: RecordRowProps) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(record.value);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const displayValue =
    record.type === 'MX' && record.priority !== undefined
      ? `${record.value} (priority: ${String(record.priority)})`
      : record.value;

  return (
    <div className="rounded-sm border border-border bg-background p-3 space-y-2">
      {/* Label + Type */}
      <div className="flex items-center justify-between">
        <span className="text-ui-sm font-medium text-text-primary">{record.label}</span>
        <span className="text-ui-xs text-text-secondary">{record.type}</span>
      </div>

      {/* Host */}
      <div className="flex items-center gap-2">
        <span className="text-ui-xs text-text-secondary shrink-0">Host:</span>
        <span className="font-mono text-ui-xs text-text-primary">{record.host}</span>
      </div>

      {/* Value + Copy */}
      <div className="flex items-start gap-2">
        <span className="text-ui-xs text-text-secondary shrink-0 pt-0.5">Value:</span>
        <span
          className="font-mono text-ui-xs text-text-primary break-all flex-1 min-w-0"
          title={record.value}
        >
          {displayValue}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="text-text-secondary hover:text-text-primary transition-fast p-0.5 rounded-sm shrink-0"
          aria-label={`Copy ${record.label} value`}
          title={`Copy ${record.label} value`}
        >
          {copied ? (
            <HugeiconsIcon
              icon={Tick01Icon as IconSvgElement}
              size={14}
              strokeWidth={1.5}
              className="text-success"
            />
          ) : (
            <HugeiconsIcon icon={Copy01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
          )}
        </button>
      </div>

      {copied && (
        <span className="text-ui-xs text-success animate-in fade-in duration-150">Copied</span>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// DnsRecordsStep
// ---------------------------------------------------------------------------

interface DnsRecordsStepProps {
  onNext: () => void;
}

const DnsRecordsStep = ({ onNext }: DnsRecordsStepProps) => {
  const [records, setRecords] = React.useState<DnsRecordsResult | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'loaded' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = React.useState('');
  const fetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchRecords = async () => {
      const base = getApiBaseUrl();

      try {
        const resp = await fetch(`${base}/setup/dns-records`);

        if (!resp.ok) {
          throw new Error(`Server responded with ${String(resp.status)}`);
        }

        const data = (await resp.json()) as DnsRecordsResult;
        setRecords(data);
        setStatus('loaded');
      } catch {
        setErrorMessage('Failed to load DNS records. Please try again.');
        setStatus('error');
      }
    };

    void fetchRecords();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-ui-lg font-medium text-text-primary">Add DNS Records</h2>
        <p className="text-ui-sm text-text-secondary">
          Add these records at your domain registrar. DNS propagation takes 24–48 hours.
        </p>
      </div>

      {/* Loading */}
      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-ui-xs text-text-secondary">Loading DNS records…</p>
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

      {/* Records */}
      {status === 'loaded' && records !== null && (
        <div className="flex flex-col gap-3">
          <RecordRow record={records.mx} />
          <RecordRow record={records.spf} />
          <RecordRow record={records.dkim} />
          <RecordRow record={records.dmarc} />
        </div>
      )}

      {/* Continue */}
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={onNext}
        disabled={status === 'loading'}
      >
        Continue
      </Button>
    </div>
  );
};

export { DnsRecordsStep };
export type { DnsRecordsStepProps };
