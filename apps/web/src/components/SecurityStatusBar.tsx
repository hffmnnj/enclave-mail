import { cn } from '@enclave/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { useSecurityStatus } from '../hooks/use-security-status.js';
import { getQueryClient } from '../lib/query-client.js';

import type { SecurityStatus } from '../hooks/use-security-status.js';

const CONNECTION_LABELS: Record<SecurityStatus['connection'], string> = {
  connected: 'CONNECTED',
  disconnected: 'OFFLINE',
  checking: 'CHECKING',
};

const formatFingerprint = (fp: string): string =>
  fp
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join(' ') ?? fp.toUpperCase();

const ConnectionIndicator = ({ connection }: { connection: SecurityStatus['connection'] }) => (
  <div className="flex items-center gap-1.5">
    <span
      className={cn(
        'size-1.5 rounded-full',
        connection === 'connected' && 'bg-success',
        connection === 'disconnected' && 'bg-danger',
        connection === 'checking' && 'bg-text-secondary animate-pulse',
      )}
      aria-hidden="true"
    />
    <span
      className={cn(
        'text-ui-xs font-mono',
        connection === 'connected' && 'text-success',
        connection === 'disconnected' && 'text-danger',
        connection === 'checking' && 'text-text-secondary',
      )}
    >
      {CONNECTION_LABELS[connection]}
    </span>
  </div>
);

const Divider = () => (
  <span className="text-text-secondary/30 text-ui-xs select-none" aria-hidden="true">
    |
  </span>
);

const EncryptionBadge = ({ mode }: { mode: SecurityStatus['encryptionMode'] }) => (
  <div className="flex items-center gap-1">
    <span
      className={cn(
        'text-ui-xs font-mono uppercase tracking-wide',
        mode === 'e2e' ? 'text-success' : 'text-secondary',
      )}
    >
      {mode === 'e2e' ? 'E2E' : 'TRANSPORT'}
    </span>
  </div>
);

const KeyFingerprint = ({ fingerprint }: { fingerprint: string | null }) => (
  <div className="flex items-center gap-1.5 min-w-0">
    <span className="text-ui-xs text-text-secondary font-mono shrink-0">KEY</span>
    <span
      className={cn(
        'text-ui-xs font-mono tracking-wider truncate',
        fingerprint ? 'text-text-primary' : 'text-danger',
      )}
    >
      {fingerprint ? formatFingerprint(fingerprint) : 'NO KEY LOADED'}
    </span>
  </div>
);

const SecurityStatusBarInner = () => {
  const status = useSecurityStatus();

  return (
    <output
      className="h-6 w-full border-t border-border bg-surface-raised px-3 flex items-center gap-3 shrink-0 select-none"
      aria-label="Security status"
    >
      <ConnectionIndicator connection={status.connection} />

      <Divider />

      <EncryptionBadge mode={status.encryptionMode} />

      <Divider />

      <KeyFingerprint fingerprint={status.keyFingerprint} />

      {status.serverVersion && (
        <>
          <div className="ml-auto" />
          <span className="text-ui-xs text-text-secondary/50 font-mono">
            v{status.serverVersion}
          </span>
        </>
      )}
    </output>
  );
};

const SecurityStatusBar = () => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SecurityStatusBarInner />
    </QueryClientProvider>
  );
};

export { SecurityStatusBar };
