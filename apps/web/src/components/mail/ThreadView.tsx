import { Badge, Button, Separator, Skeleton } from '@enclave/ui';
import {
  Archive01Icon,
  ArrowLeft01Icon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  Delete01Icon,
  FolderTransferIcon,
  LockIcon,
  MailReply01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { useDecryptMessage } from '../../hooks/use-decrypt-message.js';
import { useMailboxes } from '../../hooks/use-mailboxes.js';
import {
  useDeleteMessage,
  useMoveMessage,
  useUpdateMessageFlags,
} from '../../hooks/use-messages.js';
import { getQueryClient } from '../../lib/query-client.js';
import { SessionGate } from '../auth/SessionGate.js';
import { MessageContent } from './MessageContent.js';
import { MoveToFolderDialog } from './MoveToFolderDialog.js';

// ---------------------------------------------------------------------------
// Date formatting — full format for message view
// ---------------------------------------------------------------------------

const formatFullDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

// ---------------------------------------------------------------------------
// Verification badge
// ---------------------------------------------------------------------------

type VerificationStatus = 'pass' | 'fail' | 'neutral';

const getVerificationStatus = (status: string | null): VerificationStatus => {
  if (!status) return 'neutral';
  if (status === 'pass') return 'pass';
  if (status === 'fail' || status === 'none' || status === 'softfail') return 'fail';
  return 'neutral';
};

const VERIFICATION_VARIANTS: Record<VerificationStatus, 'success' | 'danger' | 'secondary'> = {
  pass: 'success',
  fail: 'danger',
  neutral: 'secondary',
};

const VERIFICATION_SYMBOLS: Record<VerificationStatus, string> = {
  pass: '✓',
  fail: '✗',
  neutral: '?',
};

interface VerificationBadgeProps {
  label: string;
  status: string | null;
}

const VerificationBadge = ({ label, status }: VerificationBadgeProps) => {
  const verificationStatus = getVerificationStatus(status);
  return (
    <Badge variant={VERIFICATION_VARIANTS[verificationStatus]} className="gap-0.5 text-[10px]">
      <span>{VERIFICATION_SYMBOLS[verificationStatus]}</span>
      <span>{label}</span>
    </Badge>
  );
};

// ---------------------------------------------------------------------------
// Address display
// ---------------------------------------------------------------------------

const AddressList = ({ label, addresses }: { label: string; addresses: string[] }) => {
  if (addresses.length === 0) return null;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="shrink-0 text-ui-xs text-text-secondary">{label}:</span>
      <span className="font-mono text-ui-xs text-text-primary">{addresses.join(', ')}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Encrypted state placeholder
// ---------------------------------------------------------------------------

const EncryptedPlaceholder = () => (
  <div className="flex items-center gap-2 rounded-sm border border-border bg-surface px-4 py-6">
    <HugeiconsIcon
      icon={LockIcon as IconSvgElement}
      size={18}
      strokeWidth={1.5}
      className="text-text-secondary"
    />
    <div>
      <p className="text-ui-sm font-medium text-text-primary">
        Message encrypted — session key required
      </p>
      <p className="mt-0.5 text-ui-xs text-text-secondary">
        Unlock your keys to decrypt this message.
      </p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Loading skeleton for full message
// ---------------------------------------------------------------------------

const MessageSkeleton = () => (
  <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading message">
    {/* Subject skeleton */}
    <Skeleton className="h-6 w-3/4" />

    {/* Metadata skeleton */}
    <div className="space-y-2">
      <Skeleton className="h-3.5 w-64" />
      <Skeleton className="h-3.5 w-48" />
      <Skeleton className="h-3.5 w-32" />
    </div>

    <Separator />

    {/* Body skeleton */}
    <div className="space-y-3">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

const MessageError = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div className="flex flex-col items-center justify-center py-20 text-danger">
    <p className="text-ui-base font-medium">Failed to load message</p>
    <p className="mt-1 text-ui-sm text-text-secondary">{message}</p>
    <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
      Retry
    </Button>
  </div>
);

// ---------------------------------------------------------------------------
// Reply bar — navigates to compose with pre-filled reply context
// ---------------------------------------------------------------------------

interface ReplyBarProps {
  fromAddress: string;
  subject: string;
  messageId: string;
}

const ReplyBar = ({ fromAddress, subject, messageId }: ReplyBarProps) => {
  const handleReply = React.useCallback(() => {
    const replySubject = subject.replace(/^Re:\s*/i, '');
    const params = new URLSearchParams({
      replyTo: messageId,
      subject: `Re: ${replySubject}`,
      from: fromAddress,
    });
    window.location.href = `/mail/compose?${params.toString()}`;
  }, [fromAddress, subject, messageId]);

  return (
    <button
      type="button"
      onClick={handleReply}
      className="flex w-full items-center gap-2 rounded-sm border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-raised"
    >
      <HugeiconsIcon
        icon={MailReply01Icon as IconSvgElement}
        size={14}
        strokeWidth={1.5}
        className="text-text-secondary"
      />
      <span className="text-ui-sm text-text-secondary">Reply to {fromAddress}...</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Inner thread view (requires QueryClientProvider ancestor)
// ---------------------------------------------------------------------------

interface ThreadViewInnerProps {
  messageId: string;
}

const ThreadViewInner = ({ messageId }: ThreadViewInnerProps) => {
  const {
    message,
    decryptedSubject,
    decryptedBody,
    isLoading,
    error,
    decryptionError,
    hasSessionKey,
  } = useDecryptMessage(messageId);

  // Mark message as read on mount
  // We use a dummy mailboxId — the flag update endpoint uses messageId directly
  const updateFlags = useUpdateMessageFlags('_');
  const deleteMessage = useDeleteMessage('_');
  const moveMessage = useMoveMessage('_');
  const { data: mailboxes } = useMailboxes();
  const markedReadRef = React.useRef(false);

  // Move-to-folder dialog state
  const [showMoveDialog, setShowMoveDialog] = React.useState(false);

  React.useEffect(() => {
    if (message && !message.flags.seen && !markedReadRef.current) {
      markedReadRef.current = true;
      updateFlags.mutate({ messageId: message.id, flags: { seen: true } });
    }
  }, [message, updateFlags]);

  // --- Action handlers ---

  const handleReply = React.useCallback(() => {
    if (!message) return;
    const replySubject = (decryptedSubject ?? '').replace(/^Re:\s*/i, '');
    const params = new URLSearchParams({
      replyTo: message.id,
      subject: `Re: ${replySubject}`,
      from: message.fromAddress,
    });
    window.location.href = `/mail/compose?${params.toString()}`;
  }, [message, decryptedSubject]);

  const handleForward = React.useCallback(() => {
    if (!message) return;
    const fwdSubject = (decryptedSubject ?? '').replace(/^Fwd:\s*/i, '');
    const params = new URLSearchParams({
      subject: `Fwd: ${fwdSubject}`,
    });
    // Include quoted body if available
    if (decryptedBody) {
      params.set('body', decryptedBody);
    }
    window.location.href = `/mail/compose?${params.toString()}`;
  }, [message, decryptedSubject, decryptedBody]);

  const handleArchive = React.useCallback(() => {
    if (!message || !mailboxes) return;
    const archiveMailbox = mailboxes.find((m) => m.type === 'archive');
    if (!archiveMailbox) return;
    moveMessage.mutate(
      { messageId: message.id, targetMailboxId: archiveMailbox.id },
      {
        onSuccess: () => {
          window.location.href = '/mail/inbox';
        },
      },
    );
  }, [message, mailboxes, moveMessage]);

  const handleDelete = React.useCallback(() => {
    if (!message) return;
    deleteMessage.mutate(message.id, {
      onSuccess: () => {
        window.location.href = '/mail/inbox';
      },
    });
  }, [message, deleteMessage]);

  const handleMove = React.useCallback(
    (targetMailboxId: string) => {
      if (!message) return;
      moveMessage.mutate(
        { messageId: message.id, targetMailboxId },
        {
          onSuccess: () => {
            window.location.href = '/mail/inbox';
          },
        },
      );
    },
    [message, moveMessage],
  );

  // Loading state
  if (isLoading) {
    return <MessageSkeleton />;
  }

  // Error state
  if (error || !message) {
    return (
      <MessageError
        message={error ?? 'Message not found'}
        onRetry={() => window.location.reload()}
      />
    );
  }

  const subject =
    decryptedSubject ?? (message.subjectEncrypted ? '[Encrypted Subject]' : '(No subject)');

  const hasBody = !!message.body;
  const showEncryptedPlaceholder = hasBody && !hasSessionKey && !decryptedBody;

  return (
    <div className="flex h-full flex-col">
      {/* Header bar — taller on mobile for touch targets */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2 max-md:py-2.5">
        {/* Back button — 44px touch target on mobile */}
        <Button variant="ghost" size="icon" className="h-7 w-7 max-md:h-11 max-md:w-11" asChild>
          <a href="/mail/inbox" aria-label="Back to inbox">
            <HugeiconsIcon
              icon={ArrowLeft01Icon as IconSvgElement}
              size={16}
              strokeWidth={1.5}
              className="max-md:scale-125"
            />
          </a>
        </Button>

        {/* Subject */}
        <h1 className="min-w-0 flex-1 truncate text-ui-base font-semibold text-text-primary max-md:text-ui-sm">
          {subject}
        </h1>

        {/* Action buttons — hide less important ones on mobile */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 max-md:h-11 max-md:w-11"
            aria-label="Reply"
            onClick={handleReply}
          >
            <HugeiconsIcon
              icon={ArrowTurnBackwardIcon as IconSvgElement}
              size={14}
              strokeWidth={1.5}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 max-md:hidden"
            aria-label="Forward"
            onClick={handleForward}
          >
            <HugeiconsIcon
              icon={ArrowTurnForwardIcon as IconSvgElement}
              size={14}
              strokeWidth={1.5}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 max-md:hidden"
            aria-label="Archive"
            onClick={handleArchive}
            disabled={!mailboxes?.some((m) => m.type === 'archive')}
          >
            <HugeiconsIcon icon={Archive01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 max-md:hidden"
            aria-label="Move to folder"
            onClick={() => setShowMoveDialog(true)}
          >
            <HugeiconsIcon
              icon={FolderTransferIcon as IconSvgElement}
              size={14}
              strokeWidth={1.5}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 max-md:h-11 max-md:w-11 text-danger hover:text-danger"
            aria-label="Delete"
            onClick={handleDelete}
          >
            <HugeiconsIcon icon={Delete01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      {/* Scrollable message content — full width on mobile */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-4 max-md:px-3 max-md:py-3">
          {/* Message metadata */}
          <div className="space-y-1.5">
            {/* From */}
            <div className="flex items-baseline gap-1.5 max-md:flex-wrap">
              <span className="shrink-0 text-ui-xs text-text-secondary">From:</span>
              <span className="min-w-0 truncate font-mono text-ui-xs font-medium text-text-primary">
                {message.fromAddress}
              </span>
            </div>

            {/* To */}
            <AddressList label="To" addresses={message.toAddresses} />

            {/* Date */}
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-ui-xs text-text-secondary">Date:</span>
              <span className="font-mono text-ui-xs text-text-primary">
                {formatFullDate(message.date)}
              </span>
            </div>

            {/* Verification badges */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <VerificationBadge label="DKIM" status={message.dkimStatus} />
              <VerificationBadge label="SPF" status={message.spfStatus} />
              <VerificationBadge label="DMARC" status={message.dmarcStatus} />
            </div>
          </div>

          <Separator className="my-4 max-md:my-3" />

          {/* Message body */}
          {showEncryptedPlaceholder ? (
            <EncryptedPlaceholder />
          ) : (
            <MessageContent
              htmlContent={decryptedBody ?? ''}
              isLoading={false}
              error={decryptionError}
            />
          )}

          {/* Thread continuation hint — hide on mobile for cleaner view */}
          {message.messageId && (
            <div className="mt-6 max-md:hidden">
              <Separator className="mb-4" />
              <p className="text-ui-xs text-text-secondary">
                <span className="font-mono text-text-secondary/60">Message-ID: </span>
                <span className="font-mono">{message.messageId}</span>
              </p>
            </div>
          )}

          {/* Reply bar */}
          <div id="reply-bar" className="mt-6 pb-6 max-md:mt-4 max-md:pb-4">
            <ReplyBar fromAddress={message.fromAddress} subject={subject} messageId={message.id} />
          </div>
        </div>
      </div>

      {/* Move to folder dialog */}
      {showMoveDialog && mailboxes && (
        <MoveToFolderDialog
          mailboxes={mailboxes}
          onMove={handleMove}
          onClose={() => setShowMoveDialog(false)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Public component — wraps with QueryClientProvider for React island isolation
// ---------------------------------------------------------------------------

interface ThreadViewProps {
  messageId: string;
}

const ThreadView = ({ messageId }: ThreadViewProps) => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        <ThreadViewInner messageId={messageId} />
      </SessionGate>
    </QueryClientProvider>
  );
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { ThreadView };
export type { ThreadViewProps };
