import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@enclave/ui';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

import { DnsRecordsStep } from '../onboarding/DnsRecordsStep.js';
import { DomainStep } from '../onboarding/DomainStep.js';
import { FirewallStep } from '../onboarding/FirewallStep.js';
import { RegistrationToggleStep } from '../onboarding/RegistrationToggleStep.js';
import { TlsStep } from '../onboarding/TlsStep.js';

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

const apiFetch = async (path: string, options?: RequestInit): Promise<Response> => {
  const token = getAuthToken();
  return fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
};

interface AdminStatusResponse {
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Admin user types
// ---------------------------------------------------------------------------

interface AdminUser {
  id: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
}

interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface QueueStatsResponse {
  outbound: QueueCounts;
  inbound: QueueCounts;
  deadLetter: QueueCounts;
}

interface FailedJob {
  id: string;
  name: string;
  to: string[];
  from: string;
  failedReason: string;
  processedOn: string | null;
}

interface FailedJobsResponse {
  failed: FailedJob[];
  total: number;
}

// ---------------------------------------------------------------------------
// Panel definitions
// ---------------------------------------------------------------------------

type PanelId = 'domain' | 'dns' | 'firewall' | 'tls' | 'registration' | 'users' | 'queues';

interface PanelDef {
  id: PanelId;
  title: string;
  description: string;
}

const PANELS: PanelDef[] = [
  {
    id: 'users',
    title: 'User Management',
    description: 'View, disable, enable, delete, and verify user accounts.',
  },
  {
    id: 'queues',
    title: 'Queue Monitor',
    description: 'View BullMQ queue statistics and manage failed jobs.',
  },
  {
    id: 'domain',
    title: 'Domain Configuration',
    description: 'Change your mail server\u2019s configured domain.',
  },
  {
    id: 'dns',
    title: 'DNS Records',
    description: 'View the DNS records required for your domain.',
  },
  {
    id: 'firewall',
    title: 'Firewall Ports',
    description: 'Port configuration reference for your mail server.',
  },
  {
    id: 'tls',
    title: 'TLS / SSL Certificate',
    description: 'View certificate status or trigger certbot automation.',
  },
  {
    id: 'registration',
    title: 'User Registration',
    description: 'Control who can create accounts on your server.',
  },
];

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

interface SettingsPanelProps {
  panel: PanelDef;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const SettingsPanel = ({ panel, isOpen, onToggle, children }: SettingsPanelProps) => (
  <div className="border border-border rounded-sm overflow-hidden">
    {/* Panel header — always visible, clickable to toggle */}
    <button
      className="w-full flex items-center justify-between p-4 text-left hover:bg-surface/50 transition-colors"
      onClick={onToggle}
      type="button"
      aria-expanded={isOpen}
      aria-controls={`panel-content-${panel.id}`}
    >
      <div>
        <div className="text-ui-sm font-medium text-text-primary">{panel.title}</div>
        <div className="text-ui-xs text-text-secondary">{panel.description}</div>
      </div>
      <HugeiconsIcon
        icon={ArrowDown01Icon as IconSvgElement}
        size={16}
        className={cn(
          'text-text-secondary transition-transform shrink-0 ml-3',
          isOpen && 'rotate-180',
        )}
      />
    </button>

    {/* Panel content — shown only when open */}
    {isOpen && (
      <div id={`panel-content-${panel.id}`} className="border-t border-border p-4">
        {children}
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'default' | 'destructive';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel,
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => (
  <Dialog
    open={open}
    onOpenChange={(v: boolean) => {
      if (!v) onCancel();
    }}
  >
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant={variant === 'destructive' ? 'destructive' : 'default'}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? 'Processing...' : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// ---------------------------------------------------------------------------
// UserManagementPanel
// ---------------------------------------------------------------------------

const UserManagementPanel = () => {
  const [userList, setUserList] = React.useState<AdminUser[]>([]);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = React.useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'default' | 'destructive';
    action: (() => Promise<void>) | null;
  }>({
    open: false,
    title: '',
    description: '',
    confirmLabel: '',
    variant: 'default',
    action: null,
  });

  const fetchUsers = React.useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/admin/users?page=${String(p)}&limit=20`);
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = (await res.json()) as AdminUsersResponse;
      setUserList(data.users);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchUsers(page);
  }, [page, fetchUsers]);

  const performAction = async (userId: string, action: string, method = 'POST') => {
    setActionLoading(userId);
    try {
      const res = await apiFetch(`/admin/users/${userId}/${action}`, { method });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Action failed');
      }
      await fetchUsers(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteUser = async (userId: string) => {
    setActionLoading(userId);
    try {
      const res = await apiFetch(`/admin/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Delete failed');
      }
      await fetchUsers(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  const openConfirm = (
    title: string,
    description: string,
    confirmLabel: string,
    variant: 'default' | 'destructive',
    action: () => Promise<void>,
  ) => {
    setConfirmDialog({ open: true, title, description, confirmLabel, variant, action });
  };

  const closeConfirm = () => {
    setConfirmDialog((prev) => ({ ...prev, open: false, action: null }));
  };

  const handleConfirm = async () => {
    if (confirmDialog.action) {
      await confirmDialog.action();
    }
    closeConfirm();
  };

  if (loading && userList.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-2 text-ui-sm text-text-secondary">Loading users...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-sm border border-red-300 bg-red-50 p-3 text-ui-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)} type="button">
            Dismiss
          </button>
        </div>
      )}

      <div className="text-ui-xs text-text-secondary">
        {total} user{total !== 1 ? 's' : ''} total
      </div>

      {/* User table */}
      <div className="overflow-x-auto">
        <table className="w-full text-ui-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="pb-2 pr-4 font-medium">Email</th>
              <th className="pb-2 pr-4 font-medium">Verified</th>
              <th className="pb-2 pr-4 font-medium">Admin</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {userList.map((user) => (
              <tr key={user.id} className="border-b border-border/50">
                <td className="py-2 pr-4 text-text-primary">{user.email}</td>
                <td className="py-2 pr-4">
                  {user.emailVerified ? (
                    <span className="text-green-600 dark:text-green-400" title="Verified">
                      &#10003;
                    </span>
                  ) : (
                    <span className="text-red-500 dark:text-red-400" title="Not verified">
                      &#10007;
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {user.isAdmin ? (
                    <Badge variant="default" className="text-ui-xs">
                      Admin
                    </Badge>
                  ) : (
                    <span className="text-text-secondary">&mdash;</span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {user.disabled ? (
                    <Badge variant="danger" className="text-ui-xs">
                      Disabled
                    </Badge>
                  ) : (
                    <Badge variant="success" className="text-ui-xs">
                      Active
                    </Badge>
                  )}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-1.5">
                    {!user.emailVerified && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-ui-xs"
                        disabled={actionLoading === user.id}
                        onClick={() => void performAction(user.id, 'verify')}
                      >
                        Verify
                      </Button>
                    )}
                    {user.disabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-ui-xs"
                        disabled={actionLoading === user.id}
                        onClick={() => void performAction(user.id, 'enable')}
                      >
                        Enable
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-ui-xs"
                        disabled={actionLoading === user.id || user.isAdmin}
                        onClick={() =>
                          openConfirm(
                            'Disable User',
                            `Are you sure you want to disable ${user.email}? They will be unable to log in.`,
                            'Disable',
                            'destructive',
                            () => performAction(user.id, 'disable'),
                          )
                        }
                      >
                        Disable
                      </Button>
                    )}
                    {!user.isAdmin && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-ui-xs"
                        disabled={actionLoading === user.id}
                        onClick={() =>
                          openConfirm(
                            'Delete User',
                            `Are you sure you want to permanently delete ${user.email}? This action cannot be undone.`,
                            'Delete',
                            'destructive',
                            () => deleteUser(user.id),
                          )
                        }
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-ui-xs text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-ui-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-ui-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        loading={actionLoading !== null}
        onConfirm={() => void handleConfirm()}
        onCancel={closeConfirm}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// QueueMonitorPanel
// ---------------------------------------------------------------------------

const QueueMonitorPanel = () => {
  const [stats, setStats] = React.useState<QueueStatsResponse | null>(null);
  const [failedJobs, setFailedJobs] = React.useState<FailedJob[]>([]);
  const [showFailed, setShowFailed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [retrying, setRetrying] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const fetchStats = React.useCallback(async () => {
    try {
      const res = await apiFetch('/admin/queue-stats');
      if (!res.ok) throw new Error('Failed to fetch queue stats');
      const data = (await res.json()) as QueueStatsResponse;
      setStats(data);
    } catch {
      setError('Failed to load queue stats');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFailed = async () => {
    try {
      const res = await apiFetch('/admin/queue-stats/failed');
      if (!res.ok) throw new Error('Failed to fetch failed jobs');
      const data = (await res.json()) as FailedJobsResponse;
      setFailedJobs(data.failed);
      setShowFailed(true);
    } catch {
      setError('Failed to load failed jobs');
    }
  };

  const retryJob = async (jobId: string) => {
    setRetrying(jobId);
    try {
      const res = await apiFetch(`/admin/queue-stats/retry/${jobId}`, { method: 'POST' });
      if (!res.ok) throw new Error('Retry failed');
      await fetchStats();
      await fetchFailed();
    } catch {
      setError('Failed to retry job');
    } finally {
      setRetrying(null);
    }
  };

  React.useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-2 text-ui-sm text-text-secondary">Loading queue stats...</span>
      </div>
    );
  }

  const renderQueueRow = (name: string, counts: QueueCounts) => (
    <tr key={name} className="border-b border-border/50">
      <td className="py-2 pr-4 font-medium text-text-primary capitalize">{name}</td>
      <td className="py-2 pr-4 text-text-secondary">{counts.waiting}</td>
      <td className="py-2 pr-4 text-text-secondary">{counts.active}</td>
      <td className="py-2 pr-4 text-text-secondary">{counts.completed}</td>
      <td className="py-2 pr-4 text-red-600 dark:text-red-400">{counts.failed}</td>
      <td className="py-2 text-text-secondary">{counts.delayed}</td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-sm border border-red-300 bg-red-50 p-3 text-ui-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)} type="button">
            Dismiss
          </button>
        </div>
      )}

      {stats && (
        <div className="overflow-x-auto">
          <table className="w-full text-ui-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 pr-4 font-medium">Queue</th>
                <th className="pb-2 pr-4 font-medium">Waiting</th>
                <th className="pb-2 pr-4 font-medium">Active</th>
                <th className="pb-2 pr-4 font-medium">Completed</th>
                <th className="pb-2 pr-4 font-medium">Failed</th>
                <th className="pb-2 font-medium">Delayed</th>
              </tr>
            </thead>
            <tbody>
              {renderQueueRow('outbound', stats.outbound)}
              {renderQueueRow('inbound', stats.inbound)}
              {renderQueueRow('dead letter', stats.deadLetter)}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-ui-xs"
          onClick={() => void fetchStats()}
        >
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-ui-xs"
          onClick={() => void fetchFailed()}
        >
          View Failed Jobs
        </Button>
      </div>

      {showFailed && (
        <div className="space-y-2">
          <div className="text-ui-xs font-medium text-text-primary">
            Failed Jobs ({failedJobs.length})
          </div>
          {failedJobs.length === 0 ? (
            <p className="text-ui-xs text-text-secondary">No failed jobs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-ui-xs">
                <thead>
                  <tr className="border-b border-border text-left text-text-secondary">
                    <th className="pb-2 pr-3 font-medium">ID</th>
                    <th className="pb-2 pr-3 font-medium">From</th>
                    <th className="pb-2 pr-3 font-medium">To</th>
                    <th className="pb-2 pr-3 font-medium">Reason</th>
                    <th className="pb-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {failedJobs.map((job) => (
                    <tr key={job.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-3 text-text-secondary font-mono">
                        {job.id.slice(0, 8)}
                      </td>
                      <td className="py-1.5 pr-3 text-text-primary">{job.from || '\u2014'}</td>
                      <td className="py-1.5 pr-3 text-text-primary">
                        {job.to.join(', ') || '\u2014'}
                      </td>
                      <td
                        className="py-1.5 pr-3 text-red-600 dark:text-red-400 max-w-[200px] truncate"
                        title={job.failedReason}
                      >
                        {job.failedReason}
                      </td>
                      <td className="py-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-ui-xs"
                          disabled={retrying === job.id}
                          onClick={() => void retryJob(job.id)}
                        >
                          {retrying === job.id ? 'Retrying...' : 'Retry'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// AdminSettings
// ---------------------------------------------------------------------------

type AdminCheckState = 'loading' | 'authorized' | 'unauthorized';

const AdminSettings = () => {
  const [state, setState] = React.useState<AdminCheckState>('loading');
  const [openPanel, setOpenPanel] = React.useState<PanelId | null>(null);
  const [sessionToken, setSessionToken] = React.useState('');
  const fetchedRef = React.useRef(false);

  const togglePanel = (id: PanelId) => {
    setOpenPanel((prev) => (prev === id ? null : id));
  };

  React.useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const token = getAuthToken();
    if (token) setSessionToken(token);

    const checkAdmin = async () => {
      if (!token) {
        window.location.href = '/mail/inbox';
        return;
      }

      try {
        const res = await fetch(`${getApiBaseUrl()}/setup/admin-status`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          window.location.href = '/mail/inbox';
          return;
        }

        const data = (await res.json()) as AdminStatusResponse;

        if (!data.isAdmin) {
          window.location.href = '/mail/inbox';
          return;
        }

        setState('authorized');
      } catch {
        window.location.href = '/mail/inbox';
      }
    };

    void checkAdmin();
  }, []);

  if (state === 'loading') {
    return (
      <Card className="bg-surface border-border rounded-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-ui-base font-semibold text-text-primary">
            Server Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3">
              <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-ui-sm text-text-secondary">Verifying admin access...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state === 'unauthorized') {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render panel content for each section
  // ---------------------------------------------------------------------------

  const renderPanelContent = (id: PanelId): React.ReactNode => {
    switch (id) {
      case 'users':
        return <UserManagementPanel />;
      case 'queues':
        return <QueueMonitorPanel />;
      case 'domain':
        return (
          <DomainStep
            onNext={() => {
              togglePanel('domain');
            }}
          />
        );
      case 'dns':
        return <DnsRecordsStep onNext={() => togglePanel('dns')} />;
      case 'firewall':
        return <FirewallStep onNext={() => togglePanel('firewall')} />;
      case 'tls':
        return <TlsStep onNext={() => togglePanel('tls')} />;
      case 'registration':
        return (
          <RegistrationToggleStep
            sessionToken={sessionToken}
            onNext={() => togglePanel('registration')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Card className="bg-surface border-border rounded-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-ui-base font-semibold text-text-primary">
          Server Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p className="text-text-secondary text-ui-sm">Manage your mail server configuration.</p>

          {PANELS.map((panel) => (
            <SettingsPanel
              key={panel.id}
              panel={panel}
              isOpen={openPanel === panel.id}
              onToggle={() => togglePanel(panel.id)}
            >
              {renderPanelContent(panel.id)}
            </SettingsPanel>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export { AdminSettings };
