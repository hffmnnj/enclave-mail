import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from '@enclave/ui';
import {
  Flag02Icon,
  LockIcon,
  Mail01Icon,
  MailOpen01Icon,
  SquareUnlock02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';

import type { MessageListItem } from '../../hooks/use-messages.js';

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const formatDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < SEVEN_DAYS_MS) {
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const time = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    if (isToday) return time;
    if (isYesterday) return `Yesterday ${time}`;

    const day = date.toLocaleDateString('en-US', { weekday: 'short' });
    return `${day} ${time}`;
  }

  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
};

// ---------------------------------------------------------------------------
// Encryption status
// ---------------------------------------------------------------------------

type EncryptionLevel = 'e2e' | 'transport' | 'unknown';

const getEncryptionLevel = (message: MessageListItem): EncryptionLevel => {
  const { dkimStatus, spfStatus, dmarcStatus } = message;
  const transportSecure = dkimStatus === 'pass' && spfStatus === 'pass' && dmarcStatus === 'pass';

  if (message.subjectEncrypted) {
    return 'e2e';
  }

  if (transportSecure) {
    return 'transport';
  }

  return 'unknown';
};

const ENCRYPTION_CONFIG: Record<
  EncryptionLevel,
  { icon: typeof LockIcon; color: string; label: string }
> = {
  e2e: { icon: LockIcon, color: 'text-success', label: 'End-to-end encrypted' },
  transport: { icon: LockIcon, color: 'text-secondary', label: 'Transport encrypted' },
  unknown: {
    icon: SquareUnlock02Icon,
    color: 'text-text-secondary',
    label: 'Encryption unknown',
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageRowProps {
  message: MessageListItem;
  decryptedSubject?: string | undefined;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onClick: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MessageRow = ({
  message,
  decryptedSubject,
  isSelected,
  onSelect,
  onClick,
}: MessageRowProps) => {
  const isUnread = !message.flags.seen;
  const isFlagged = message.flags.flagged;
  const encryptionLevel = getEncryptionLevel(message);
  const encConfig = ENCRYPTION_CONFIG[encryptionLevel];

  const subject = decryptedSubject ?? (message.subjectEncrypted ? '[Encrypted]' : '(No subject)');

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onSelect(message.id);
  };

  return (
    <li
      className={cn(
        'group flex h-9 items-center gap-2 border-b border-border px-3 transition-fast',
        'hover:bg-surface-raised',
        isUnread ? 'bg-surface/80' : 'bg-background',
        isSelected && 'border-l-2 border-l-primary bg-primary/5',
        !isSelected && 'border-l-2 border-l-transparent',
      )}
      data-unread={isUnread || undefined}
    >
      {/* Checkbox */}
      <div className="flex shrink-0 items-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          className="size-3.5 cursor-pointer rounded-sm border border-border bg-background accent-primary"
          aria-label={`Select message from ${message.fromAddress}`}
        />
      </div>

      {/* Clickable row content — using a button for keyboard accessibility */}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent p-0 text-left"
        aria-label={`Open message from ${message.fromAddress}: ${subject}`}
      >
        {/* Read/Unread indicator */}
        <span className="flex shrink-0 items-center">
          <HugeiconsIcon
            icon={(isUnread ? Mail01Icon : MailOpen01Icon) as IconSvgElement}
            size={13}
            strokeWidth={1.5}
            className={cn('transition-fast', isUnread ? 'text-primary' : 'text-text-secondary/40')}
          />
        </span>

        {/* Sender */}
        <span
          className={cn(
            'w-40 shrink-0 truncate font-mono text-ui-xs',
            isUnread ? 'font-medium text-text-primary' : 'text-text-secondary',
          )}
          title={message.fromAddress}
        >
          {message.fromAddress}
        </span>

        {/* Subject */}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-ui-sm',
            isUnread ? 'font-medium text-text-primary' : 'text-text-secondary',
          )}
        >
          {subject}
        </span>

        {/* Flagged indicator */}
        {isFlagged && (
          <HugeiconsIcon
            icon={Flag02Icon as IconSvgElement}
            size={12}
            strokeWidth={1.5}
            className="shrink-0 text-secondary"
          />
        )}

        {/* Encryption status */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 items-center">
                <HugeiconsIcon
                  icon={encConfig.icon as IconSvgElement}
                  size={12}
                  strokeWidth={1.5}
                  className={cn('transition-fast', encConfig.color)}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-ui-xs">
              {encConfig.label}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Date */}
        <span
          className={cn(
            'w-24 shrink-0 text-right font-mono text-ui-xs',
            isUnread ? 'text-text-primary' : 'text-text-secondary',
          )}
          title={new Date(message.date).toLocaleString()}
        >
          {formatDate(message.date)}
        </span>
      </button>
    </li>
  );
};

export { MessageRow };
export type { MessageRowProps, EncryptionLevel };
