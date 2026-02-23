import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Skeleton,
  cn,
} from '@enclave/ui';
import {
  Alert01Icon,
  Copy01Icon,
  Download02Icon,
  Key01Icon,
  Refresh01Icon,
  Shield01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { getQueryClient } from '../../lib/query-client.js';
import { KeyExportDialog } from './KeyExportDialog.js';
import { KeyRotationDialog } from './KeyRotationDialog.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeyInfo {
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  isActive: boolean;
}

interface KeysResponse {
  data: {
    x25519: KeyInfo;
    ed25519: KeyInfo;
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

const fetchKeys = async (): Promise<KeysResponse['data']> => {
  const res = await fetch(`${getApiBaseUrl()}/keys`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load keys');
  const json = (await res.json()) as KeysResponse;
  return json.data;
};

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

const formatDate = (iso: string): string => {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

// ---------------------------------------------------------------------------
// Truncate public key for display
// ---------------------------------------------------------------------------

const truncateKey = (key: string): string => {
  if (key.length <= 20) return key;
  return `${key.slice(0, 8)}...${key.slice(-8)}`;
};

// ---------------------------------------------------------------------------
// Copy to clipboard
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
// KeyCard — displays a single key's info
// ---------------------------------------------------------------------------

interface KeyCardProps {
  label: string;
  keyInfo: KeyInfo;
}

const KeyCard = ({ label, keyInfo }: KeyCardProps) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopyFingerprint = async () => {
    const success = await copyToClipboard(keyInfo.fingerprint);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-sm border border-border bg-surface-raised/30 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Key01Icon as IconSvgElement}
            size={14}
            strokeWidth={1.5}
            className="text-text-secondary"
          />
          <span className="text-ui-sm font-medium text-text-primary">{label}</span>
        </div>
        <Badge
          variant="default"
          className={cn(
            'text-ui-xs px-1.5 py-0',
            keyInfo.isActive
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-amber/30 bg-amber/10 text-amber',
          )}
        >
          {keyInfo.isActive ? 'Active' : 'Rotated'}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <div>
          <p className="text-ui-xs text-text-secondary mb-0.5">Fingerprint</p>
          <div className="flex items-center gap-1.5">
            <code className="font-mono text-ui-sm text-primary">{keyInfo.fingerprint}</code>
            <button
              type="button"
              onClick={() => void handleCopyFingerprint()}
              className="text-text-secondary hover:text-text-primary transition-fast p-0.5 rounded-sm"
              aria-label="Copy fingerprint"
              title="Copy fingerprint"
            >
              <HugeiconsIcon icon={Copy01Icon as IconSvgElement} size={12} strokeWidth={1.5} />
            </button>
            {copied && (
              <span className="text-ui-xs text-success animate-in fade-in duration-150">
                Copied
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div>
            <p className="text-ui-xs text-text-secondary mb-0.5">Public Key</p>
            <code className="font-mono text-ui-xs text-text-secondary">
              {truncateKey(keyInfo.publicKey)}
            </code>
          </div>
          <div>
            <p className="text-ui-xs text-text-secondary mb-0.5">Created</p>
            <span className="text-ui-xs text-text-secondary">{formatDate(keyInfo.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const KeysSkeleton = () => (
  <Card className="bg-surface border-border rounded-sm">
    <CardHeader className="pb-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-sm" />
        <Skeleton className="h-5 w-36 rounded-sm" />
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={`key-skel-${String(i)}`}
          className="rounded-sm border border-border p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40 rounded-sm" />
            <Skeleton className="h-4 w-14 rounded-sm" />
          </div>
          <Skeleton className="h-4 w-48 rounded-sm" />
          <Skeleton className="h-3 w-32 rounded-sm" />
        </div>
      ))}
    </CardContent>
  </Card>
);

// ---------------------------------------------------------------------------
// Inner component (requires QueryClientProvider ancestor)
// ---------------------------------------------------------------------------

const KeyManagementInner = () => {
  const queryClient = useQueryClient();
  const [exportOpen, setExportOpen] = React.useState(false);
  const [rotationOpen, setRotationOpen] = React.useState(false);

  const {
    data: keys,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['keys'],
    queryFn: fetchKeys,
  });

  const handleRotationComplete = () => {
    void queryClient.invalidateQueries({ queryKey: ['keys'] });
  };

  if (isLoading) {
    return <KeysSkeleton />;
  }

  if (isError) {
    return (
      <Card className="bg-surface border-border rounded-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-ui-base font-semibold text-text-primary flex items-center gap-2">
            <HugeiconsIcon
              icon={Shield01Icon as IconSvgElement}
              size={18}
              strokeWidth={1.5}
              className="text-primary"
            />
            Encryption Keys
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2.5">
            <p className="text-ui-xs text-danger">
              {error instanceof Error ? error.message : 'Failed to load keys.'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-ui-xs"
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!keys) return null;

  return (
    <>
      <Card className="bg-surface border-border rounded-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-ui-base font-semibold text-text-primary flex items-center gap-2">
              <HugeiconsIcon
                icon={Shield01Icon as IconSvgElement}
                size={18}
                strokeWidth={1.5}
                className="text-primary"
              />
              Encryption Keys
            </CardTitle>
            <Badge
              variant="default"
              className="border-success/30 bg-success/10 text-success text-ui-xs px-1.5 py-0"
            >
              Active
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <KeyCard label="X25519 Encryption Key" keyInfo={keys.x25519} />
          <KeyCard label="Ed25519 Signing Key" keyInfo={keys.ed25519} />

          <Separator />

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/80 text-background"
              onClick={() => setExportOpen(true)}
            >
              <HugeiconsIcon
                icon={Download02Icon as IconSvgElement}
                size={14}
                strokeWidth={1.5}
                className="mr-1.5"
              />
              Export Keys
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-text-secondary hover:text-text-primary"
              onClick={() => setRotationOpen(true)}
            >
              <HugeiconsIcon
                icon={Refresh01Icon as IconSvgElement}
                size={14}
                strokeWidth={1.5}
                className="mr-1.5"
              />
              Rotate Keys
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Unrecoverable data warning — always visible, non-dismissible */}
      <div
        className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-3"
        role="alert"
        aria-live="polite"
      >
        <div className="flex items-start gap-2">
          <HugeiconsIcon
            icon={Alert01Icon as IconSvgElement}
            size={16}
            strokeWidth={1.5}
            className="mt-0.5 shrink-0 text-danger"
          />
          <div>
            <p className="text-ui-sm font-medium text-danger">Unrecoverable Data Warning</p>
            <p className="mt-1 text-ui-xs text-danger/80 leading-relaxed">
              If you lose your passphrase AND your key export file, your data is permanently
              unrecoverable. There is no server-side recovery. Export your keys regularly and store
              the backup in a safe location.
            </p>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <KeyExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <KeyRotationDialog
        open={rotationOpen}
        onOpenChange={setRotationOpen}
        onRotationComplete={handleRotationComplete}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// Public component — wraps with QueryClientProvider for React island isolation
// ---------------------------------------------------------------------------

const KeyManagement = () => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <KeyManagementInner />
    </QueryClientProvider>
  );
};

export { KeyManagement };
