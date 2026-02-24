import { Button, cn } from '@enclave/ui';
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

interface RegistrationStatusResponse {
  enabled: boolean;
}

interface RegistrationUpdateResponse {
  success: boolean;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Toggle switch (no Switch in @enclave/ui)
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  onChange: (checked: boolean) => void;
}

const ToggleSwitch = ({
  checked,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  onChange,
}: ToggleSwitchProps) => (
  <button
    type="button"
    role="switch"
    id={id}
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    className={cn(
      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      checked ? 'bg-primary' : 'bg-border',
    )}
    onClick={() => onChange(!checked)}
  >
    <span
      className={cn(
        'pointer-events-none block h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform duration-200',
        checked ? 'translate-x-4' : 'translate-x-0.5',
      )}
    />
  </button>
);

// ---------------------------------------------------------------------------
// RegistrationToggleStep
// ---------------------------------------------------------------------------

interface RegistrationToggleStepProps {
  sessionToken: string;
  onNext: () => void;
}

const RegistrationToggleStep = ({ sessionToken, onNext }: RegistrationToggleStepProps) => {
  const [enabled, setEnabled] = React.useState(true);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = React.useState('');

  // Fetch current registration state on mount
  const fetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchStatus = async () => {
      const base = getApiBaseUrl();

      try {
        const resp = await fetch(`${base}/setup/registration`);

        if (resp.ok) {
          const data = (await resp.json()) as RegistrationStatusResponse;
          setEnabled(data.enabled);
        }

        setStatus('ready');
      } catch {
        setStatus('ready');
      }
    };

    void fetchStatus();
  }, []);

  const handleToggle = async (newValue: boolean) => {
    setEnabled(newValue);
    setStatus('saving');
    setErrorMessage('');

    const base = getApiBaseUrl();

    try {
      const resp = await fetch(`${base}/setup/registration`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ enabled: newValue }),
      });

      if (!resp.ok) {
        throw new Error(`Server responded with ${String(resp.status)}`);
      }

      const data = (await resp.json()) as RegistrationUpdateResponse;

      if (data.success) {
        setEnabled(data.enabled);
        setStatus('ready');
      } else {
        throw new Error('Update was not successful');
      }
    } catch {
      setEnabled(!newValue);
      setErrorMessage('Failed to update registration setting. Please try again.');
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-ui-lg font-medium text-text-primary">Registration Settings</h2>
        <p className="text-ui-sm text-text-secondary">
          Control who can create accounts on your mail server.
        </p>
      </div>

      {/* Loading state */}
      {status === 'loading' && (
        <div className="flex items-center gap-3 py-4">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-ui-sm text-text-secondary">Loading settings…</span>
        </div>
      )}

      {/* Toggle section */}
      {status !== 'loading' && (
        <div className="rounded-sm border border-border bg-background p-4">
          <div className="flex items-start gap-3">
            <ToggleSwitch
              id="registration-toggle"
              checked={enabled}
              disabled={status === 'saving'}
              aria-label="Allow user registration"
              onChange={(val) => void handleToggle(val)}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="registration-toggle"
                className="text-ui-sm font-medium text-text-primary cursor-pointer"
              >
                Allow user registration
              </label>
              <p className="text-ui-xs text-text-secondary leading-relaxed">
                When enabled, anyone can register for an account. Disable this to prevent new
                registrations after your team is set up.
              </p>
            </div>
          </div>

          {/* Status indicator */}
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-ui-xs text-text-secondary">
              Registration is currently{' '}
              <span className={cn('font-medium', enabled ? 'text-success' : 'text-text-primary')}>
                {enabled ? 'enabled' : 'disabled'}
              </span>
              {status === 'saving' && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-text-secondary">
                  <span className="h-3 w-3 animate-spin rounded-full border border-text-secondary border-t-transparent" />
                  Saving…
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && errorMessage && (
        <div className="rounded-sm border border-danger/30 bg-danger/10 p-3">
          <p className="text-ui-xs text-danger" role="alert">
            {errorMessage}
          </p>
        </div>
      )}

      {/* Finish */}
      {status !== 'loading' && (
        <Button type="button" size="lg" className="w-full" onClick={onNext}>
          Finish Setup
        </Button>
      )}
    </div>
  );
};

export { RegistrationToggleStep };
export type { RegistrationToggleStepProps };
