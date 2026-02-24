import { Button } from '@enclave/ui';
import { Copy01Icon, SecurityCheckIcon, Tick01Icon } from '@hugeicons/core-free-icons';
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

interface TlsStatusResponse {
  hasCertificate: boolean;
  domain: string;
  certPath?: string;
}

interface TlsTriggerResponse {
  success: boolean;
  message: string;
  output?: string;
}

interface DomainResponse {
  domain: string | null;
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable
    }
  };

  return (
    <button
      type="button"
      className="flex items-center gap-1 text-ui-xs text-text-secondary hover:text-text-primary transition-fast"
      onClick={() => void handleCopy()}
      aria-label={copied ? 'Copied' : 'Copy command'}
    >
      <HugeiconsIcon
        icon={(copied ? Tick01Icon : Copy01Icon) as IconSvgElement}
        size={14}
        strokeWidth={1.5}
      />
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// TlsStep
// ---------------------------------------------------------------------------

interface TlsStepProps {
  onNext: () => void;
}

type TlsStatus = 'loading' | 'no-cert' | 'has-cert';
type TriggerStatus = 'idle' | 'running' | 'success' | 'error';

const TlsStep = ({ onNext }: TlsStepProps) => {
  const [domain, setDomain] = React.useState('');
  const [tlsStatus, setTlsStatus] = React.useState<TlsStatus>('loading');
  const [triggerStatus, setTriggerStatus] = React.useState<TriggerStatus>('idle');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [fetchError, setFetchError] = React.useState('');

  const certbotCommand = domain
    ? `certbot certonly --standalone -d ${domain} -d mail.${domain}`
    : 'certbot certonly --standalone -d yourdomain.com -d mail.yourdomain.com';

  const canContinue = tlsStatus === 'has-cert' || triggerStatus === 'success';

  // Fetch TLS status + domain on mount
  const fetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchStatus = async () => {
      const base = getApiBaseUrl();

      try {
        const [tlsResp, domainResp] = await Promise.all([
          fetch(`${base}/setup/tls-status`),
          fetch(`${base}/setup/domain`),
        ]);

        let resolvedDomain = '';

        if (domainResp.ok) {
          const domainData = (await domainResp.json()) as DomainResponse;
          if (domainData.domain) {
            resolvedDomain = domainData.domain;
            setDomain(domainData.domain);
          }
        }

        if (tlsResp.ok) {
          const tlsData = (await tlsResp.json()) as TlsStatusResponse;
          setTlsStatus(tlsData.hasCertificate ? 'has-cert' : 'no-cert');
          if (tlsData.domain && !resolvedDomain) {
            setDomain(tlsData.domain);
          }
        } else {
          setTlsStatus('no-cert');
        }
      } catch {
        setFetchError('Could not check TLS status. You can still proceed manually.');
        setTlsStatus('no-cert');
      }
    };

    void fetchStatus();
  }, []);

  const handleTriggerCertbot = async () => {
    setTriggerStatus('running');
    setErrorMessage('');

    const base = getApiBaseUrl();

    try {
      const resp = await fetch(`${base}/setup/tls-trigger`, { method: 'POST' });

      if (!resp.ok) {
        throw new Error(`Server responded with ${String(resp.status)}`);
      }

      const data = (await resp.json()) as TlsTriggerResponse;

      if (data.success) {
        setTriggerStatus('success');
      } else {
        setErrorMessage(data.message + (data.output ? `\n${data.output}` : ''));
        setTriggerStatus('error');
      }
    } catch {
      setErrorMessage('Failed to run certbot. Please use the manual instructions below.');
      setTriggerStatus('error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-ui-lg font-medium text-text-primary">TLS / SSL Certificate</h2>
        <p className="text-ui-sm text-text-secondary">
          Secure your mail server with a TLS certificate.
        </p>
      </div>

      {/* Loading state */}
      {tlsStatus === 'loading' && (
        <div className="flex items-center gap-3 py-4">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-ui-sm text-text-secondary">Checking certificate status…</span>
        </div>
      )}

      {/* Fetch error */}
      {fetchError && (
        <div className="rounded-sm border border-amber/30 bg-amber/10 p-3">
          <p className="text-ui-xs text-amber">{fetchError}</p>
        </div>
      )}

      {/* Certificate found banner */}
      {tlsStatus === 'has-cert' && (
        <div className="flex items-center gap-2.5 rounded-sm border border-success/30 bg-success/10 p-3">
          <HugeiconsIcon
            icon={SecurityCheckIcon as IconSvgElement}
            size={18}
            strokeWidth={1.5}
            className="text-success shrink-0"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-ui-sm text-success font-medium">Certificate found</span>
            {domain && (
              <span className="text-ui-xs text-text-secondary">
                TLS certificate is configured for {domain}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Certbot trigger success */}
      {triggerStatus === 'success' && tlsStatus !== 'has-cert' && (
        <div className="flex items-center gap-2.5 rounded-sm border border-success/30 bg-success/10 p-3">
          <HugeiconsIcon
            icon={Tick01Icon as IconSvgElement}
            size={18}
            strokeWidth={1.5}
            className="text-success shrink-0"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-ui-sm text-success font-medium">
              Certificate provisioned successfully
            </span>
            {domain && (
              <span className="text-ui-xs text-text-secondary">
                TLS certificate is now active for {domain}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Certbot command block */}
      {tlsStatus !== 'loading' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-ui-xs text-text-secondary">Certbot command</span>
            <CopyButton text={certbotCommand} />
          </div>
          <pre className="bg-background border border-border rounded-sm p-3 font-mono text-ui-xs text-text-primary overflow-x-auto whitespace-pre">
            {certbotCommand}
          </pre>
        </div>
      )}

      {/* Automated trigger */}
      {tlsStatus === 'no-cert' && triggerStatus !== 'success' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <span className="text-ui-xs font-medium text-text-primary">Automated</span>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              disabled={triggerStatus === 'running'}
              onClick={() => void handleTriggerCertbot()}
            >
              {triggerStatus === 'running' ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Running certbot…
                </span>
              ) : (
                'Run certbot automatically'
              )}
            </Button>
            {triggerStatus === 'running' && (
              <p className="text-ui-xs text-text-secondary">
                This may take up to 60 seconds. Please wait…
              </p>
            )}
          </div>

          {/* Error message */}
          {triggerStatus === 'error' && errorMessage && (
            <div className="rounded-sm border border-danger/30 bg-danger/10 p-3">
              <pre className="text-ui-xs text-danger whitespace-pre-wrap font-mono">
                {errorMessage}
              </pre>
            </div>
          )}

          {/* Manual instructions */}
          <div className="flex flex-col gap-1.5">
            <span className="text-ui-xs font-medium text-text-primary">Manual</span>
            <div className="rounded-sm border border-border bg-background p-3">
              <p className="text-ui-xs text-text-secondary leading-relaxed">
                If automated provisioning fails, run the certbot command above in your server
                terminal. Make sure port 80 is open and no other service is using it. After
                obtaining the certificate, return here and continue.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {tlsStatus !== 'loading' && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={!canContinue}
            onClick={onNext}
          >
            Continue
          </Button>
          {!canContinue && (
            <button
              type="button"
              className="text-ui-xs text-text-secondary hover:text-text-primary transition-fast text-center"
              onClick={onNext}
            >
              Skip for now
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export { TlsStep };
export type { TlsStepProps };
