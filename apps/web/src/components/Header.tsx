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
  Input,
  cn,
} from '@enclave/ui';
import {
  Add01Icon,
  Key01Icon,
  Logout01Icon,
  Menu01Icon,
  Search01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';

interface HeaderProps {
  onMenuOpen?: () => void;
}

const Header = ({ onMenuOpen }: HeaderProps) => {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
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

      {/* Search */}
      <div className="relative flex-1 max-w-sm">
        <HugeiconsIcon
          icon={Search01Icon as IconSvgElement}
          size={14}
          strokeWidth={1.5}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary"
        />
        <Input
          type="search"
          placeholder="Search mail..."
          className="h-7 pl-7 text-ui-sm"
          aria-label="Search mail"
        />
      </div>

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
              <HugeiconsIcon icon={Settings01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
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
    </header>
  );
};

export { Header };
export type { HeaderProps };
