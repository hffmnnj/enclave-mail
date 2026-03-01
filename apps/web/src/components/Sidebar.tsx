import { Badge, ScrollArea, Separator, Skeleton, cn } from '@enclave/ui';
import {
  Archive01Icon,
  Cancel01Icon,
  Delete01Icon,
  Folder01Icon,
  InboxIcon,
  Key01Icon,
  Logout01Icon,
  MailSend01Icon,
  Menu01Icon,
  PencilEdit01Icon,
  Settings01Icon,
  Settings02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { useMailboxes } from '../hooks/use-mailboxes.js';
import { clearInMemorySessionSecrets } from '../lib/crypto-client.js';
import { getQueryClient } from '../lib/query-client.js';
import { FolderManager } from './mail/FolderManager.js';

import type { Mailbox, MailboxType } from '../hooks/use-mailboxes.js';

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

// ---------------------------------------------------------------------------
// useIsAdmin — checks admin status via API
// ---------------------------------------------------------------------------

const useIsAdmin = (): boolean => {
  const [isAdmin, setIsAdmin] = React.useState(false);
  const fetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const check = async () => {
      const token = getAuthToken();
      if (!token) return;

      try {
        const res = await fetch(`${getApiBaseUrl()}/setup/admin-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { isAdmin: boolean };
        setIsAdmin(data.isAdmin === true);
      } catch {
        // Silently fail — non-admin is the safe default
      }
    };

    void check();
  }, []);

  return isAdmin;
};

// ---------------------------------------------------------------------------
// Icon mapping for mailbox types
// ---------------------------------------------------------------------------

const MAILBOX_ICON_MAP: Record<MailboxType, IconSvgElement> = {
  inbox: InboxIcon as IconSvgElement,
  sent: MailSend01Icon as IconSvgElement,
  drafts: PencilEdit01Icon as IconSvgElement,
  trash: Delete01Icon as IconSvgElement,
  archive: Archive01Icon as IconSvgElement,
  custom: Folder01Icon as IconSvgElement,
};

const MAILBOX_PATH_MAP: Record<string, string> = {
  inbox: '/mail/inbox',
  sent: '/mail/sent',
  drafts: '/mail/drafts',
  trash: '/mail/trash',
  archive: '/mail/archive',
};

const getMailboxPath = (mailbox: Mailbox): string => {
  if (mailbox.type !== 'custom') {
    return MAILBOX_PATH_MAP[mailbox.type] ?? `/mail/${mailbox.name.toLowerCase()}`;
  }
  return `/mail/folder/${mailbox.id}`;
};

const getMailboxIcon = (type: MailboxType): IconSvgElement => {
  return MAILBOX_ICON_MAP[type] ?? (Folder01Icon as IconSvgElement);
};

// ---------------------------------------------------------------------------
// System mailbox display order
// ---------------------------------------------------------------------------

const SYSTEM_ORDER: MailboxType[] = ['inbox', 'sent', 'drafts', 'trash', 'archive'];

const sortMailboxes = (mailboxes: Mailbox[]): { system: Mailbox[]; custom: Mailbox[] } => {
  const system: Mailbox[] = [];
  const custom: Mailbox[] = [];

  for (const m of mailboxes) {
    if (m.type === 'custom') {
      custom.push(m);
    } else {
      system.push(m);
    }
  }

  system.sort((a, b) => {
    const ai = SYSTEM_ORDER.indexOf(a.type);
    const bi = SYSTEM_ORDER.indexOf(b.type);
    return ai - bi;
  });

  custom.sort((a, b) => a.name.localeCompare(b.name));

  return { system, custom };
};

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

const isActive = (currentPath: string, itemPath: string): boolean => {
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
};

// ---------------------------------------------------------------------------
// NavLink — single mailbox navigation item
// ---------------------------------------------------------------------------

interface NavLinkProps {
  path: string;
  icon: IconSvgElement;
  label: string;
  active: boolean;
  unreadCount?: number;
  collapsed?: boolean | undefined;
}

const NavLink = ({ path, icon, label, active, unreadCount, collapsed }: NavLinkProps) => (
  <a
    href={path}
    className={cn(
      'relative flex items-center gap-2 rounded-sm transition-fast',
      collapsed ? 'h-10 w-10 justify-center' : 'h-8 px-3',
      active
        ? 'bg-primary/10 text-primary'
        : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary',
    )}
    aria-current={active ? 'page' : undefined}
    title={collapsed ? label : undefined}
    aria-label={collapsed ? label : undefined}
  >
    <HugeiconsIcon icon={icon} size={collapsed ? 18 : 16} strokeWidth={1.5} className="shrink-0" />
    {!collapsed && (
      <>
        <span className="flex-1 truncate text-ui-sm">{label}</span>
        {unreadCount !== undefined && unreadCount > 0 && (
          <Badge
            variant="default"
            className="ml-auto h-4 min-w-[1.25rem] justify-center border-amber/30 bg-amber/10 px-1 text-ui-xs text-amber"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </>
    )}
    {collapsed && unreadCount !== undefined && unreadCount > 0 && (
      <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2 rounded-full bg-secondary" />
    )}
  </a>
);

// ---------------------------------------------------------------------------
// Static bottom nav items
// ---------------------------------------------------------------------------

interface StaticNavItem {
  label: string;
  path: string;
  icon: IconSvgElement;
}

const bottomNav: StaticNavItem[] = [
  { label: 'Settings', path: '/settings', icon: Settings01Icon as IconSvgElement },
  { label: 'Keys', path: '/keys', icon: Key01Icon as IconSvgElement },
];

// ---------------------------------------------------------------------------
// Skeleton loading state for mailbox list
// ---------------------------------------------------------------------------

const MailboxSkeleton = ({ collapsed }: { collapsed?: boolean | undefined }) => (
  <div className={cn('flex flex-col gap-0.5', collapsed ? 'items-center p-1' : 'p-2')}>
    {Array.from({ length: 5 }).map((_, i) => (
      <div
        key={`skel-${String(i)}`}
        className={cn(
          'flex items-center',
          collapsed ? 'h-10 w-10 justify-center' : 'h-8 gap-2 px-3',
        )}
      >
        <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
        {!collapsed && <Skeleton className="h-3 flex-1 rounded-sm" />}
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Mailbox list — fetches live data
// ---------------------------------------------------------------------------

interface MailboxListProps {
  currentPath: string;
  collapsed?: boolean;
}

const MailboxList = ({ currentPath, collapsed }: MailboxListProps) => {
  const { data: mailboxes, isLoading, error } = useMailboxes();

  if (isLoading) {
    return <MailboxSkeleton collapsed={collapsed} />;
  }

  if (error) {
    return <div className="p-3 text-ui-xs text-danger">Failed to load mailboxes</div>;
  }

  if (!mailboxes || mailboxes.length === 0) {
    return <div className="p-3 text-ui-xs text-text-secondary">No mailboxes found</div>;
  }

  const { system, custom } = sortMailboxes(mailboxes);

  return (
    <nav
      className={cn('flex flex-col gap-0.5', collapsed ? 'items-center p-1' : 'p-2')}
      aria-label="Mailboxes"
    >
      {system.map((m) => (
        <NavLink
          key={m.id}
          path={getMailboxPath(m)}
          icon={getMailboxIcon(m.type)}
          label={m.name}
          active={isActive(currentPath, getMailboxPath(m))}
          unreadCount={m.unreadCount}
          collapsed={collapsed}
        />
      ))}

      {custom.length > 0 && (
        <>
          <Separator className="my-1" />
          {custom.map((m) => (
            <NavLink
              key={m.id}
              path={getMailboxPath(m)}
              icon={getMailboxIcon(m.type)}
              label={m.name}
              active={isActive(currentPath, getMailboxPath(m))}
              unreadCount={m.unreadCount}
              collapsed={collapsed}
            />
          ))}
        </>
      )}

      {!collapsed && (
        <>
          <Separator className="my-1" />
          <FolderManager />
        </>
      )}
    </nav>
  );
};

// ---------------------------------------------------------------------------
// Logout handler (shared between expanded and collapsed modes)
// ---------------------------------------------------------------------------

const handleLogout = () => {
  const token = (() => {
    try {
      return localStorage.getItem('enclave:sessionToken');
    } catch {
      return null;
    }
  })();

  try {
    clearInMemorySessionSecrets();
    localStorage.removeItem('enclave:sessionToken');
    localStorage.removeItem('enclave:userEmail');
  } catch {
    // Storage may be unavailable
  }

  if (token) {
    const base =
      typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL
        ? (import.meta.env.PUBLIC_API_URL as string)
        : 'http://localhost:3001';

    fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
      // Intentionally ignored — fire and forget
    });
  }

  window.location.href = '/login';
};

// ---------------------------------------------------------------------------
// useMediaQuery hook for responsive behavior
// ---------------------------------------------------------------------------

const useMediaQuery = (query: string): boolean => {
  // Always initialise to false on the server so SSR and client first-render match.
  // The real value is applied in useEffect (client only), after hydration completes.
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
};

// ---------------------------------------------------------------------------
// Sidebar inner — requires QueryClientProvider ancestor
// ---------------------------------------------------------------------------

interface SidebarInnerProps {
  currentPath: string;
  isOpen?: boolean | undefined;
  onClose?: (() => void) | undefined;
}

const SidebarInner = ({ currentPath, isOpen, onClose }: SidebarInnerProps) => {
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isMobile = !isTablet && !isDesktop;
  const isAdmin = useIsAdmin();

  // Tablet rail: collapsed by default, expandable
  const [tabletExpanded, setTabletExpanded] = React.useState(false);

  // Close sidebar on Escape key (mobile drawer)
  React.useEffect(() => {
    if (!isMobile || !isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, isOpen, onClose]);

  // Lock body scroll when mobile drawer is open
  React.useEffect(() => {
    if (!isMobile || !isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, isOpen]);

  // Determine collapsed state: tablet rail when not expanded
  const collapsed = isTablet && !tabletExpanded;

  // ---------------------------------------------------------------------------
  // Mobile drawer
  // ---------------------------------------------------------------------------
  if (isMobile) {
    return (
      <>
        {/* Overlay */}
        {isOpen && (
          <div
            className="overlay-fade fixed inset-0 z-40 bg-background/60"
            onClick={onClose}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onClose?.();
            }}
            role="button"
            tabIndex={-1}
            aria-label="Close sidebar"
          />
        )}

        {/* Drawer */}
        <aside
          className={cn(
            'sidebar-drawer fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface safe-area-inset',
            isOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-label="Sidebar navigation"
          aria-hidden={!isOpen}
        >
          {/* Header with close button */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
            <a href="/mail/inbox" className="flex items-center gap-1.5 text-primary">
              <span className="font-mono text-ui-md font-semibold" aria-hidden="true">
                &oplus;
              </span>
              <span className="font-mono text-ui-sm font-semibold tracking-wide">Enclave</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary transition-fast hover:bg-surface-raised hover:text-text-primary"
              aria-label="Close navigation"
            >
              <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={18} strokeWidth={1.5} />
            </button>
          </div>

          {/* Navigation */}
          <ScrollArea className="flex-1">
            <MailboxList currentPath={currentPath} />
          </ScrollArea>

          {/* Bottom section */}
          <div className="shrink-0">
            <Separator />
            <nav className="flex flex-col gap-0.5 p-2" aria-label="Settings">
              {bottomNav.map((item) => (
                <NavLink
                  key={item.path}
                  path={item.path}
                  icon={item.icon}
                  label={item.label}
                  active={isActive(currentPath, item.path)}
                />
              ))}
              {isAdmin && (
                <NavLink
                  path="/admin/settings"
                  icon={Settings02Icon as IconSvgElement}
                  label="Admin Settings"
                  active={isActive(currentPath, '/admin/settings')}
                />
              )}
              <button
                type="button"
                className="flex h-10 w-full items-center gap-2 rounded-sm px-3 text-ui-sm text-text-secondary transition-fast hover:bg-surface-raised hover:text-danger"
                onClick={handleLogout}
              >
                <HugeiconsIcon
                  icon={Logout01Icon as IconSvgElement}
                  size={16}
                  strokeWidth={1.5}
                  className="shrink-0"
                />
                <span>Logout</span>
              </button>
            </nav>
          </div>
        </aside>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Tablet rail / expanded sidebar
  // ---------------------------------------------------------------------------
  if (isTablet) {
    return (
      <aside
        className={cn(
          'sidebar-drawer flex h-full shrink-0 flex-col border-r border-border bg-surface',
          collapsed ? 'w-14' : 'w-56',
        )}
        aria-label="Sidebar navigation"
      >
        {/* Logo area */}
        <div
          className={cn(
            'flex h-10 shrink-0 items-center border-b border-border',
            collapsed ? 'justify-center px-1' : 'px-3',
          )}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={() => setTabletExpanded(true)}
              className="flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary transition-fast hover:bg-surface-raised hover:text-text-primary"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <HugeiconsIcon icon={Menu01Icon as IconSvgElement} size={16} strokeWidth={1.5} />
            </button>
          ) : (
            <div className="flex w-full items-center justify-between">
              <a href="/mail/inbox" className="flex items-center gap-1.5 text-primary">
                <span className="font-mono text-ui-md font-semibold" aria-hidden="true">
                  &oplus;
                </span>
                <span className="font-mono text-ui-sm font-semibold tracking-wide">Enclave</span>
              </a>
              <button
                type="button"
                onClick={() => setTabletExpanded(false)}
                className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary transition-fast hover:bg-surface-raised hover:text-text-primary"
                aria-label="Collapse sidebar"
              >
                <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <MailboxList currentPath={currentPath} collapsed={collapsed} />
        </ScrollArea>

        {/* Bottom section */}
        <div className="shrink-0">
          <Separator />
          <nav
            className={cn('flex flex-col gap-0.5', collapsed ? 'items-center p-1' : 'p-2')}
            aria-label="Settings"
          >
            {bottomNav.map((item) => (
              <NavLink
                key={item.path}
                path={item.path}
                icon={item.icon}
                label={item.label}
                active={isActive(currentPath, item.path)}
                collapsed={collapsed}
              />
            ))}
            {isAdmin && (
              <NavLink
                path="/admin/settings"
                icon={Settings02Icon as IconSvgElement}
                label="Admin Settings"
                active={isActive(currentPath, '/admin/settings')}
                collapsed={collapsed}
              />
            )}
            <button
              type="button"
              className={cn(
                'flex items-center rounded-sm text-text-secondary transition-fast hover:bg-surface-raised hover:text-danger',
                collapsed ? 'h-10 w-10 justify-center' : 'h-8 w-full gap-2 px-3 text-ui-sm',
              )}
              onClick={handleLogout}
              title={collapsed ? 'Logout' : undefined}
              aria-label={collapsed ? 'Logout' : undefined}
            >
              <HugeiconsIcon
                icon={Logout01Icon as IconSvgElement}
                size={collapsed ? 18 : 16}
                strokeWidth={1.5}
                className="shrink-0"
              />
              {!collapsed && <span>Logout</span>}
            </button>
          </nav>
        </div>
      </aside>
    );
  }

  // ---------------------------------------------------------------------------
  // Desktop — full sidebar (original behavior)
  // ---------------------------------------------------------------------------
  return (
    <aside
      className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-surface"
      aria-label="Sidebar navigation"
    >
      {/* Logo area */}
      <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
        <a href="/mail/inbox" className="flex items-center gap-1.5 text-primary">
          <span className="font-mono text-ui-md font-semibold" aria-hidden="true">
            &oplus;
          </span>
          <span className="font-mono text-ui-sm font-semibold tracking-wide">Enclave</span>
        </a>
      </div>

      {/* Main navigation — live mailbox data */}
      <ScrollArea className="flex-1">
        <MailboxList currentPath={currentPath} />
      </ScrollArea>

      {/* Bottom section */}
      <div className="shrink-0">
        <Separator />
        <nav className="flex flex-col gap-0.5 p-2" aria-label="Settings">
          {bottomNav.map((item) => (
            <NavLink
              key={item.path}
              path={item.path}
              icon={item.icon}
              label={item.label}
              active={isActive(currentPath, item.path)}
            />
          ))}
          {isAdmin && (
            <NavLink
              path="/admin/settings"
              icon={Settings02Icon as IconSvgElement}
              label="Admin Settings"
              active={isActive(currentPath, '/admin/settings')}
            />
          )}
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-sm px-3 text-ui-sm text-text-secondary transition-fast hover:bg-surface-raised hover:text-danger"
            onClick={handleLogout}
          >
            <HugeiconsIcon
              icon={Logout01Icon as IconSvgElement}
              size={16}
              strokeWidth={1.5}
              className="shrink-0"
            />
            <span>Logout</span>
          </button>
        </nav>
      </div>
    </aside>
  );
};

// ---------------------------------------------------------------------------
// Public component — wraps with QueryClientProvider for React island isolation
// ---------------------------------------------------------------------------

interface SidebarProps {
  currentPath?: string;
  isOpen?: boolean;
  onClose?: () => void;
}

const Sidebar = ({ currentPath = '/', isOpen, onClose }: SidebarProps) => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarInner currentPath={currentPath} isOpen={isOpen} onClose={onClose} />
    </QueryClientProvider>
  );
};

export { Sidebar };
export type { SidebarProps };
