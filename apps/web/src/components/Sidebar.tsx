import { Badge, ScrollArea, Separator, cn } from '@enclave/ui';
import {
  Archive01Icon,
  Delete01Icon,
  InboxIcon,
  Key01Icon,
  Logout01Icon,
  MailSend01Icon,
  PencilEdit01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';

interface NavItem {
  label: string;
  path: string;
  icon: IconSvgElement;
  count?: number;
}

const mailboxNav: NavItem[] = [
  { label: 'Inbox', path: '/mail/inbox', icon: InboxIcon as IconSvgElement },
  { label: 'Sent', path: '/mail/sent', icon: MailSend01Icon as IconSvgElement },
  { label: 'Drafts', path: '/mail/drafts', icon: PencilEdit01Icon as IconSvgElement },
  { label: 'Trash', path: '/mail/trash', icon: Delete01Icon as IconSvgElement },
  { label: 'Archive', path: '/mail/archive', icon: Archive01Icon as IconSvgElement },
];

const bottomNav: NavItem[] = [
  { label: 'Settings', path: '/settings', icon: Settings01Icon as IconSvgElement },
  { label: 'Keys', path: '/keys', icon: Key01Icon as IconSvgElement },
];

interface SidebarProps {
  currentPath?: string;
  unreadCounts?: Record<string, number>;
  isOpen?: boolean;
  onClose?: () => void;
}

const isActive = (currentPath: string, itemPath: string): boolean => {
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
};

const NavLink = ({
  item,
  active,
  count,
}: {
  item: NavItem;
  active: boolean;
  count?: number | undefined;
}) => (
  <a
    href={item.path}
    className={cn(
      'flex h-8 items-center gap-2 rounded-sm px-3 text-ui-sm transition-fast',
      active
        ? 'bg-primary/10 text-primary'
        : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary',
    )}
    aria-current={active ? 'page' : undefined}
  >
    <HugeiconsIcon icon={item.icon} size={16} strokeWidth={1.5} className="shrink-0" />
    <span className="flex-1 truncate">{item.label}</span>
    {count !== undefined && count > 0 && (
      <Badge
        variant="default"
        className="ml-auto h-4 min-w-[1.25rem] justify-center px-1 text-ui-xs"
      >
        {count > 99 ? '99+' : count}
      </Badge>
    )}
  </a>
);

const Sidebar = ({ currentPath = '/', unreadCounts = {}, isOpen, onClose }: SidebarProps) => {
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
          // Mobile: slide-in drawer
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:relative md:z-auto md:translate-x-0',
          isOpen === true ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          // Hide on mobile by default when not explicitly opened
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

        {/* Main navigation */}
        <ScrollArea className="flex-1">
          <nav className="flex flex-col gap-0.5 p-2" aria-label="Mailboxes">
            {mailboxNav.map((item) => (
              <NavLink
                key={item.path}
                item={item}
                active={isActive(currentPath, item.path)}
                count={unreadCounts[item.label.toLowerCase()]}
              />
            ))}
          </nav>
        </ScrollArea>

        {/* Bottom section */}
        <div className="shrink-0">
          <Separator />
          <nav className="flex flex-col gap-0.5 p-2" aria-label="Settings">
            {bottomNav.map((item) => (
              <NavLink key={item.path} item={item} active={isActive(currentPath, item.path)} />
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

export { Sidebar };
export type { SidebarProps };
