import { Card, CardContent, CardHeader, CardTitle, cn } from '@enclave/ui';
import {
  ComputerIcon,
  Moon01Icon,
  Notification01Icon,
  PaintBrush01Icon,
  Sun01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { getQueryClient } from '../../lib/query-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserPreferences {
  displayName?: string;
  signature?: string;
  theme: 'dark' | 'light' | 'system';
  notificationsEnabled: boolean;
  autoMarkRead: boolean;
  messagesPerPage: number;
}

type ThemeOption = 'dark' | 'light' | 'system';

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

const fetchSettings = async (): Promise<UserPreferences> => {
  const res = await fetch(`${getApiBaseUrl()}/settings`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load settings');
  const json = (await res.json()) as { data: UserPreferences };
  return json.data;
};

const updateSettings = async (updates: Partial<UserPreferences>): Promise<UserPreferences> => {
  const res = await fetch(`${getApiBaseUrl()}/settings`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to save settings');
  const json = (await res.json()) as { data: UserPreferences };
  return json.data;
};

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

const applyTheme = (theme: ThemeOption): void => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
    root.classList.toggle('light', !prefersDark);
  } else {
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
  }
};

// ---------------------------------------------------------------------------
// Toggle switch component
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

const ToggleSwitch = ({ id, checked, onChange, disabled, label }: ToggleSwitchProps) => (
  <label
    htmlFor={id}
    className={cn(
      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors duration-200',
      checked ? 'bg-primary border-primary' : 'bg-surface',
      disabled && 'cursor-not-allowed opacity-50',
    )}
  >
    <input
      id={id}
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="sr-only"
      aria-label={label}
    />
    <span
      className={cn(
        'pointer-events-none block size-3.5 rounded-full bg-text-primary shadow-sm transition-transform duration-200',
        checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
      )}
    />
  </label>
);

// ---------------------------------------------------------------------------
// Theme section
// ---------------------------------------------------------------------------

interface ThemeSectionProps {
  currentTheme: ThemeOption;
  onThemeChange: (theme: ThemeOption) => void;
  isPending: boolean;
}

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: IconSvgElement }[] = [
  { value: 'dark', label: 'Dark', icon: Moon01Icon as IconSvgElement },
  { value: 'light', label: 'Light', icon: Sun01Icon as IconSvgElement },
  { value: 'system', label: 'System', icon: ComputerIcon as IconSvgElement },
];

const ThemeSection = ({ currentTheme, onThemeChange, isPending }: ThemeSectionProps) => (
  <fieldset className="border-0 p-0 m-0">
    <legend className="block text-ui-xs text-text-secondary mb-1.5">Theme</legend>
    <div
      className="inline-flex rounded-sm border border-border overflow-hidden"
      role="radiogroup"
      aria-label="Theme selection"
    >
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={isPending}
          onClick={() => onThemeChange(opt.value)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-ui-xs transition-fast',
            currentTheme === opt.value
              ? 'bg-primary text-background font-medium'
              : 'bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-raised',
            isPending && 'opacity-50 cursor-not-allowed',
          )}
          aria-pressed={currentTheme === opt.value}
        >
          <HugeiconsIcon icon={opt.icon} size={14} strokeWidth={1.5} />
          {opt.label}
        </button>
      ))}
    </div>
  </fieldset>
);

// ---------------------------------------------------------------------------
// Messages per page section
// ---------------------------------------------------------------------------

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200] as const;

interface PageSizeSectionProps {
  currentSize: number;
  onSizeChange: (size: number) => void;
  isPending: boolean;
}

const PageSizeSection = ({ currentSize, onSizeChange, isPending }: PageSizeSectionProps) => (
  <div>
    <label htmlFor="messages-per-page" className="block text-ui-xs text-text-secondary mb-1">
      Messages per page
    </label>
    <select
      id="messages-per-page"
      value={currentSize}
      onChange={(e) => onSizeChange(Number(e.target.value))}
      disabled={isPending}
      className={cn(
        'flex h-7 rounded border border-border bg-surface px-2 py-1 text-ui-base text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'transition-colors duration-default',
      )}
    >
      {PAGE_SIZE_OPTIONS.map((size) => (
        <option key={size} value={size}>
          {size}
        </option>
      ))}
    </select>
  </div>
);

// ---------------------------------------------------------------------------
// Inner component (requires QueryClientProvider ancestor)
// ---------------------------------------------------------------------------

const AppearanceSettingsInner = () => {
  const queryClient = useQueryClient();
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    data: settings,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });

  const debouncedUpdate = React.useCallback(
    (updates: Partial<UserPreferences>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        mutation.mutate(updates);
      }, 500);
    },
    [mutation],
  );

  // Cleanup debounce on unmount
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleThemeChange = React.useCallback(
    (theme: ThemeOption) => {
      applyTheme(theme);
      // Optimistic update
      queryClient.setQueryData(['settings'], (prev: UserPreferences | undefined) =>
        prev ? { ...prev, theme } : prev,
      );
      mutation.mutate({ theme });
    },
    [mutation, queryClient],
  );

  const handlePageSizeChange = React.useCallback(
    (messagesPerPage: number) => {
      queryClient.setQueryData(['settings'], (prev: UserPreferences | undefined) =>
        prev ? { ...prev, messagesPerPage } : prev,
      );
      debouncedUpdate({ messagesPerPage });
    },
    [debouncedUpdate, queryClient],
  );

  const handleNotificationsChange = React.useCallback(
    (notificationsEnabled: boolean) => {
      queryClient.setQueryData(['settings'], (prev: UserPreferences | undefined) =>
        prev ? { ...prev, notificationsEnabled } : prev,
      );
      debouncedUpdate({ notificationsEnabled });
    },
    [debouncedUpdate, queryClient],
  );

  const handleAutoMarkReadChange = React.useCallback(
    (autoMarkRead: boolean) => {
      queryClient.setQueryData(['settings'], (prev: UserPreferences | undefined) =>
        prev ? { ...prev, autoMarkRead } : prev,
      );
      debouncedUpdate({ autoMarkRead });
    },
    [debouncedUpdate, queryClient],
  );

  if (isLoading) {
    return (
      <Card className="bg-surface border-border rounded-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-ui-base font-semibold text-text-primary">
            Appearance &amp; Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="h-3 w-16 animate-pulse rounded bg-border" />
            <div className="h-7 w-48 animate-pulse rounded bg-border" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-28 animate-pulse rounded bg-border" />
            <div className="h-5 w-9 animate-pulse rounded-full bg-border" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="bg-surface border-border rounded-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-ui-base font-semibold text-text-primary">
            Appearance &amp; Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-ui-xs text-danger">
            {error instanceof Error ? error.message : 'Failed to load settings.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!settings) return null;

  return (
    <Card className="bg-surface border-border rounded-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-ui-base font-semibold text-text-primary">
          Appearance &amp; Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Appearance */}
        <div className="space-y-3">
          <h3 className="text-ui-sm font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
            <HugeiconsIcon icon={PaintBrush01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
            Appearance
          </h3>

          <div className="space-y-3">
            <ThemeSection
              currentTheme={settings.theme}
              onThemeChange={handleThemeChange}
              isPending={mutation.isPending}
            />
            <PageSizeSection
              currentSize={settings.messagesPerPage}
              onSizeChange={handlePageSizeChange}
              isPending={mutation.isPending}
            />
          </div>
        </div>

        {/* Notifications */}
        <div className="space-y-3">
          <h3 className="text-ui-sm font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
            <HugeiconsIcon
              icon={Notification01Icon as IconSvgElement}
              size={14}
              strokeWidth={1.5}
            />
            Notifications
          </h3>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between max-w-sm">
              <label htmlFor="notifications-toggle" className="text-ui-xs text-text-primary">
                Enable notifications
              </label>
              <ToggleSwitch
                id="notifications-toggle"
                checked={settings.notificationsEnabled}
                onChange={handleNotificationsChange}
                disabled={mutation.isPending}
                label="Enable notifications"
              />
            </div>

            <div className="flex items-center justify-between max-w-sm">
              <label htmlFor="auto-mark-read-toggle" className="text-ui-xs text-text-primary">
                Auto-mark as read
              </label>
              <ToggleSwitch
                id="auto-mark-read-toggle"
                checked={settings.autoMarkRead}
                onChange={handleAutoMarkReadChange}
                disabled={mutation.isPending}
                label="Auto-mark messages as read"
              />
            </div>
          </div>
        </div>

        {/* Save status */}
        {mutation.isPending && <p className="text-ui-xs text-text-secondary">Saving...</p>}
        {mutation.isError && (
          <p className="text-ui-xs text-danger">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to save.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Public component — wraps with QueryClientProvider for React island isolation
// ---------------------------------------------------------------------------

const AppearanceSettings = () => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceSettingsInner />
    </QueryClientProvider>
  );
};

export { AppearanceSettings };
