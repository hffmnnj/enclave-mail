import { Button } from '@enclave/ui';
import {
  Archive01Icon,
  Cancel01Icon,
  Delete01Icon,
  Folder01Icon,
  InboxIcon,
  MailSend01Icon,
  PencilEdit01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

import type { Mailbox, MailboxType } from '../../hooks/use-mailboxes.js';

// ---------------------------------------------------------------------------
// Icon mapping (mirrors Sidebar)
// ---------------------------------------------------------------------------

const MAILBOX_ICON_MAP: Record<MailboxType, IconSvgElement> = {
  inbox: InboxIcon as IconSvgElement,
  sent: MailSend01Icon as IconSvgElement,
  drafts: PencilEdit01Icon as IconSvgElement,
  trash: Delete01Icon as IconSvgElement,
  archive: Archive01Icon as IconSvgElement,
  custom: Folder01Icon as IconSvgElement,
};

const getMailboxIcon = (type: MailboxType): IconSvgElement =>
  MAILBOX_ICON_MAP[type] ?? (Folder01Icon as IconSvgElement);

// ---------------------------------------------------------------------------
// MoveToFolderDialog
// ---------------------------------------------------------------------------

interface MoveToFolderDialogProps {
  mailboxes: Mailbox[];
  onMove: (targetMailboxId: string) => void;
  onClose: () => void;
}

const MoveToFolderDialog = ({ mailboxes, onMove, onClose }: MoveToFolderDialogProps) => {
  // Close on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-background/60"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') onClose();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Close dialog"
      />

      {/* Dialog */}
      <div
        className="fixed left-1/2 top-1/2 z-50 w-72 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface shadow-lg"
        aria-label="Move to folder"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-ui-sm font-medium text-text-primary">Move to folder</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
            aria-label="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
          </Button>
        </div>

        {/* Mailbox list */}
        <div className="max-h-64 overflow-auto p-1">
          {mailboxes.map((mailbox) => (
            <button
              key={mailbox.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-ui-sm text-text-primary transition-colors hover:bg-surface-raised"
              onClick={() => {
                onMove(mailbox.id);
                onClose();
              }}
            >
              <HugeiconsIcon
                icon={getMailboxIcon(mailbox.type)}
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-text-secondary"
              />
              <span className="truncate">{mailbox.name}</span>
              {mailbox.messageCount > 0 && (
                <span className="ml-auto text-ui-xs text-text-secondary">
                  {mailbox.messageCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

export { MoveToFolderDialog };
export type { MoveToFolderDialogProps };
