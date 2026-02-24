import { Button, Input, Separator, cn } from '@enclave/ui';
import { Cancel01Icon, Delete01Icon, LockIcon, MailSend01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { getSessionKey, useEncryptSend, useSaveDraft } from '../../hooks/use-encrypt-send.js';
import { getQueryClient } from '../../lib/query-client.js';
import { RecipientInput } from './RecipientInput.js';
import { TipTapEditor } from './TipTapEditor.js';

// ---------------------------------------------------------------------------
// Global augmentation for session key (shared with InboxView, ThreadView)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __enclave_session_key?: Uint8Array;
  }
}

// ---------------------------------------------------------------------------
// Reply-to context
// ---------------------------------------------------------------------------

interface ReplyToContext {
  messageId?: string | undefined;
  subject?: string | undefined;
  fromAddress?: string | undefined;
}

// ---------------------------------------------------------------------------
// Encryption status indicator
// ---------------------------------------------------------------------------

const EncryptionStatus = ({ hasKey }: { hasKey: boolean }) => (
  <div className="flex items-center gap-1.5">
    <HugeiconsIcon
      icon={LockIcon as IconSvgElement}
      size={12}
      strokeWidth={1.5}
      className={hasKey ? 'text-success' : 'text-danger'}
    />
    <span className={cn('text-ui-xs', hasKey ? 'text-success' : 'text-danger')}>
      {hasKey ? 'Encrypted with your key' : 'No encryption key — re-authenticate'}
    </span>
  </div>
);

// ---------------------------------------------------------------------------
// Draft save status
// ---------------------------------------------------------------------------

type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

const DraftStatusIndicator = ({ status }: { status: DraftStatus }) => {
  if (status === 'idle') return null;

  const labels: Record<DraftStatus, string> = {
    idle: '',
    saving: 'Saving...',
    saved: 'Draft saved',
    error: 'Save failed',
  };

  const colors: Record<DraftStatus, string> = {
    idle: '',
    saving: 'text-text-secondary',
    saved: 'text-text-secondary/60',
    error: 'text-danger',
  };

  return <span className={cn('text-ui-xs', colors[status])}>{labels[status]}</span>;
};

// ---------------------------------------------------------------------------
// Inner compose view (requires QueryClientProvider ancestor)
// ---------------------------------------------------------------------------

interface ComposeViewInnerProps {
  replyTo?: ReplyToContext | undefined;
}

const ComposeViewInner = ({ replyTo }: ComposeViewInnerProps) => {
  // Form state
  const [toRecipients, setToRecipients] = React.useState<string[]>(
    replyTo?.fromAddress ? [replyTo.fromAddress] : [],
  );
  const [ccRecipients, setCcRecipients] = React.useState<string[]>([]);
  const [bccRecipients, setBccRecipients] = React.useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = React.useState(false);
  const [subject, setSubject] = React.useState(
    replyTo?.subject ? `Re: ${replyTo.subject.replace(/^Re:\s*/i, '')}` : '',
  );
  const [htmlBody, setHtmlBody] = React.useState('');
  const [draftStatus, setDraftStatus] = React.useState<DraftStatus>('idle');

  // Encryption state
  const hasSessionKey = React.useMemo(() => !!getSessionKey(), []);

  // Mutations
  const sendMutation = useEncryptSend();
  const draftMutation = useSaveDraft();

  // Track content changes for auto-save
  const lastSavedRef = React.useRef('');
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build a content fingerprint for change detection
  const contentFingerprint = React.useMemo(
    () => JSON.stringify({ to: toRecipients, cc: ccRecipients, subject, body: htmlBody }),
    [toRecipients, ccRecipients, subject, htmlBody],
  );

  // Auto-save draft every 30s if content changed
  React.useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      if (contentFingerprint !== lastSavedRef.current && (subject || htmlBody)) {
        lastSavedRef.current = contentFingerprint;
        setDraftStatus('saving');
        draftMutation.mutate(
          {
            to: toRecipients.length > 0 ? toRecipients : undefined,
            cc: ccRecipients.length > 0 ? ccRecipients : undefined,
            subject: subject || undefined,
            htmlBody: htmlBody || undefined,
          },
          {
            onSuccess: () => setDraftStatus('saved'),
            onError: () => setDraftStatus('error'),
          },
        );
      }
    }, 30_000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [contentFingerprint, draftMutation, toRecipients, ccRecipients, subject, htmlBody]);

  const handleSend = React.useCallback(() => {
    if (!hasSessionKey || sendMutation.isPending) return;
    if (toRecipients.length === 0) return;
    if (!subject.trim()) return;

    sendMutation.mutate(
      {
        to: toRecipients,
        cc: ccRecipients.length > 0 ? ccRecipients : undefined,
        bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
        subject,
        htmlBody: htmlBody || '<p></p>',
      },
      {
        onSuccess: () => {
          // Navigate back to inbox after successful send
          window.location.href = '/mail/inbox';
        },
      },
    );
  }, [hasSessionKey, sendMutation, toRecipients, ccRecipients, bccRecipients, subject, htmlBody]);

  // Ctrl+Enter to send — use ref to avoid stale closure
  const handleSendRef = React.useRef(handleSend);
  handleSendRef.current = handleSend;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSendRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleDiscard = React.useCallback(() => {
    // Navigate back without saving
    window.location.href = '/mail/inbox';
  }, []);

  const canSend =
    hasSessionKey &&
    toRecipients.length > 0 &&
    subject.trim().length > 0 &&
    !sendMutation.isPending;

  return (
    <div className="flex h-full flex-col max-md:mobile-fullscreen max-md:bg-background">
      {/* Header bar — taller on mobile with close button */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2 max-md:py-2.5">
        {/* Close / Discard button — 44px touch target on mobile */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 max-md:h-11 max-md:w-11"
          aria-label="Discard"
          onClick={handleDiscard}
        >
          <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
        </Button>

        <h1 className="min-w-0 flex-1 text-ui-base font-semibold text-text-primary">
          {replyTo ? 'Reply' : 'New Message'}
        </h1>

        <Button
          variant="default"
          size="sm"
          className="gap-1.5 max-md:h-10 max-md:px-4"
          disabled={!canSend}
          onClick={handleSend}
          aria-label="Send message"
        >
          <HugeiconsIcon
            icon={hasSessionKey ? (LockIcon as IconSvgElement) : (MailSend01Icon as IconSvgElement)}
            size={13}
            strokeWidth={1.5}
          />
          <span>{sendMutation.isPending ? 'Sending...' : 'Send'}</span>
        </Button>
      </div>

      {/* Scrollable compose area — full width on mobile */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-3 max-md:px-3">
          {/* Recipients */}
          <div className="space-y-1.5">
            <RecipientInput
              value={toRecipients}
              onChange={setToRecipients}
              label="To"
              placeholder="Add recipients"
            />

            {!showCcBcc && (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="ml-8 text-ui-xs text-primary hover:text-primary/80 transition-colors max-md:ml-0"
              >
                CC / BCC
              </button>
            )}

            {showCcBcc && (
              <>
                <RecipientInput value={ccRecipients} onChange={setCcRecipients} label="CC" />
                <RecipientInput value={bccRecipients} onChange={setBccRecipients} label="BCC" />
              </>
            )}
          </div>

          {/* Subject */}
          <div className="mt-3">
            <Input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="h-8 border-0 border-b border-border rounded-none bg-transparent px-0 text-ui-base font-medium text-text-primary placeholder:text-text-secondary/40 focus-visible:ring-0 focus-visible:border-primary max-md:h-10 max-md:text-ui-md"
              aria-label="Subject"
            />
          </div>

          <Separator className="my-3" />

          {/* Rich text editor — taller on mobile for comfortable typing */}
          <div className="min-h-[300px] max-md:min-h-[200px]">
            <TipTapEditor
              content={htmlBody}
              onChange={setHtmlBody}
              placeholder="Write your message..."
              autoFocus={!replyTo}
            />
          </div>
        </div>
      </div>

      {/* Footer bar — safe area padding on mobile for notched devices */}
      <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-3 py-1.5 max-md:pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <EncryptionStatus hasKey={hasSessionKey} />

        <div className="flex-1" />

        <DraftStatusIndicator status={draftStatus} />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-ui-xs text-danger hover:text-danger max-md:hidden"
          onClick={handleDiscard}
        >
          <HugeiconsIcon icon={Delete01Icon as IconSvgElement} size={12} strokeWidth={1.5} />
          Discard
        </Button>
      </div>

      {/* Send error toast */}
      {sendMutation.isError && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 rounded-sm border border-danger bg-danger/10 px-4 py-2 text-ui-sm text-danger shadow-modal max-md:bottom-16">
          {sendMutation.error instanceof Error
            ? sendMutation.error.message
            : 'Failed to send message'}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Public component — wraps with QueryClientProvider for React island isolation
// ---------------------------------------------------------------------------

interface ComposeViewProps {
  replyTo?: ReplyToContext | undefined;
}

const ComposeView = ({ replyTo }: ComposeViewProps) => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ComposeViewInner replyTo={replyTo} />
    </QueryClientProvider>
  );
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { ComposeView };
export type { ComposeViewProps, ReplyToContext };
