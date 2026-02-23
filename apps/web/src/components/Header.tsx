import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@enclave/ui';
import {
  Add01Icon,
  Cancel01Icon,
  Key01Icon,
  Logout01Icon,
  Menu01Icon,
  Search01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

import { useSearchState } from '../hooks/use-search.js';
import { SearchBar } from './mail/SearchBar.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HeaderProps {
  onMenuOpen?: () => void;
  mailboxId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Header = ({ onMenuOpen, mailboxId }: HeaderProps) => {
  const { query, setQuery, filters, setFilters, clearSearch, isSearchActive } = useSearchState();
  const [expanded, setExpanded] = React.useState(false);

  const handleSearch = React.useCallback(
    (newQuery: string, newFilters: Parameters<typeof setFilters>[0]) => {
      setQuery(newQuery);
      if (typeof newFilters === 'object') {
        setFilters(newFilters);
      }
    },
    [setQuery, setFilters],
  );

  const handleToggleSearch = React.useCallback(() => {
    if (expanded) {
      clearSearch();
      setExpanded(false);
    } else {
      setExpanded(true);
    }
  }, [expanded, clearSearch]);

  // Auto-expand when URL has search params
  React.useEffect(() => {
    if (isSearchActive && !expanded) {
      setExpanded(true);
    }
  }, [isSearchActive, expanded]);

  return (
    <header className="shrink-0 border-b border-border bg-background">
      {/* Top bar */}
      <div className="flex h-10 items-center gap-2 px-3">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMenuOpen}
          aria-label="Open navigation menu"
        >
          <HugeiconsIcon icon={Menu01Icon as IconSvgElement} size={16} strokeWidth={1.5} />
        </Button>

        {/* Search toggle */}
        <Button
          variant={expanded ? 'default' : 'ghost'}
          size="icon"
          onClick={handleToggleSearch}
          aria-label={expanded ? 'Close search' : 'Open search'}
          aria-expanded={expanded}
          className={cn('shrink-0', isSearchActive && !expanded && 'text-primary')}
        >
          <HugeiconsIcon
            icon={(expanded ? Cancel01Icon : Search01Icon) as IconSvgElement}
            size={14}
            strokeWidth={1.5}
          />
        </Button>

        {/* Active search indicator (when collapsed) */}
        {isSearchActive && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1 rounded-sm border border-primary/20 bg-primary/5 px-2 py-0.5 text-ui-xs text-primary transition-colors hover:bg-primary/10"
          >
            <HugeiconsIcon icon={Search01Icon as IconSvgElement} size={11} strokeWidth={1.5} />
            <span className="max-w-32 truncate">{query || 'Filtered'}</span>
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Compose button */}
        <Button variant="default" size="sm" asChild>
          <a href="/mail/compose" className="gap-1.5">
            <HugeiconsIcon icon={Add01Icon as IconSvgElement} size={14} strokeWidth={2} />
            <span>Compose</span>
          </a>
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="User menu">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-primary/20 text-primary text-ui-xs">U</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="text-ui-sm font-medium text-text-primary">Account</p>
              <p className={cn('text-ui-xs text-text-secondary truncate-email font-mono')}>
                user@enclave.local
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/settings" className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={Settings01Icon as IconSvgElement}
                  size={14}
                  strokeWidth={1.5}
                />
                Settings
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="/keys" className="flex items-center gap-2">
                <HugeiconsIcon icon={Key01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
                Keys
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-danger focus:text-danger"
              onClick={() => {
                // Logout handler — will be wired in Wave 10
              }}
            >
              <HugeiconsIcon
                icon={Logout01Icon as IconSvgElement}
                size={14}
                strokeWidth={1.5}
                className="mr-2"
              />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Expanded search panel */}
      {expanded && (
        <div className="border-t border-border bg-surface/30 px-3 py-2">
          <SearchBar
            mailboxId={mailboxId ?? 'inbox'}
            onSearch={handleSearch}
            query={query}
            filters={filters}
            className="max-w-lg"
          />
        </div>
      )}
    </header>
  );
};

export { Header };
export type { HeaderProps };
