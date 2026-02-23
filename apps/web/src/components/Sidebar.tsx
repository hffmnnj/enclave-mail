import { Badge, ScrollArea, Separator, Skeleton, cn } from '@enclave/ui';
import {
  Archive01Icon,
  Delete01Icon,
  Folder01Icon,
  InboxIcon,
  Key01Icon,
  Logout01Icon,
  MailSend01Icon,
  PencilEdit01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { useMailboxes } from '../hooks/use-mailboxes.js';
import { getQueryClient } from '../lib/query-client.js';
import { FolderManager } from './mail/FolderManager.js';

import type { Mailbox, MailboxType } from '../hooks/use-mailboxes.js';

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
}

const NavLink = ({ path, icon, label, active, unreadCount }: NavLinkProps) => (
  <a
    href={path}
    className={cn(
      'flex h-8 items-center gap-2 rounded-sm px-3 text-ui-sm transition-fast',
      active
        ? 'bg-primary/10 text-primary'
        : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary',
    )}
    aria-current={active ? 'page' : undefined}
  >
    <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} className="shrink-0" />
    <span className="flex-1 truncate">{label}</span>
    {unreadCount !== undefined && unreadCount > 0 && (
      <Badge
        variant="default"
        className="ml-auto h-4 min-w-[1.25rem] justify-center border-amber/30 bg-amber/10 px-1 text-ui-xs text-amber"
      >
        {unreadCount > 99 ? '99+' : unreadCount}
      </Badge>
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

const MailboxSkeleton = () => (
  <div className="flex flex-col gap-0.5 p-2">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={`skel-${String(i)}`} className="flex h-8 items-center gap-2 px-3">
        <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
        <Skeleton className="h-3 flex-1 rounded-sm" />
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Mailbox list — fetches live data
// ---------------------------------------------------------------------------

interface MailboxListProps {
  currentPath: string;
}

const MailboxList = ({ currentPath }: MailboxListProps) => {
  const { data: mailboxes, isLoading, error } = useMailboxes();

  if (isLoading) {
    return <MailboxSkeleton />;
  }

  if (error) {
    return <div className="p-3 text-ui-xs text-danger">Failed to load mailboxes</div>;
  }

  if (!mailboxes || mailboxes.length === 0) {
    return <div className="p-3 text-ui-xs text-text-secondary">No mailboxes found</div>;
  }

  const { system, custom } = sortMailboxes(mailboxes);

  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Mailboxes">
      {system.map((m) => (
        <NavLink
          key={m.id}
          path={getMailboxPath(m)}
          icon={getMailboxIcon(m.type)}
          label={m.name}
          active={isActive(currentPath, getMailboxPath(m))}
          unreadCount={m.unreadCount}
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
            />
          ))}
        </>
      )}

      <Separator className="my-1" />
      <FolderManager />
    </nav>
  );
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
  return (
    <>
      {/* Mobile overlay */}
      {isOpen === true && (
        <div
          className="fixed inset-0 z-40 bg-background/60 md:hidden"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.();
          }}
          role="button"
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'flex h-full w-56 shrink-0 flex-col border-r border-border bg-surface',
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:relative md:z-auto md:translate-x-0',
          isOpen === true ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          isOpen === undefined && 'hidden md:flex',
          isOpen !== undefined && 'flex',
        )}
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
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-sm px-3 text-ui-sm text-text-secondary transition-fast hover:bg-surface-raised hover:text-danger"
              onClick={() => {
                // Logout handler — will be wired in Wave 10
              }}
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
