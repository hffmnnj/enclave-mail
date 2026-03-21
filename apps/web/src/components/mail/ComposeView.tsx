import { Button, Input, Separator, cn } from '@enclave/ui';
import {
  Attachment01Icon,
  Cancel01Icon,
  Delete01Icon,
  LockIcon,
  MailSend01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { getSessionKey, useEncryptSend, useSaveDraft } from '../../hooks/use-encrypt-send.js';
import type { SendResult } from '../../hooks/use-encrypt-send.js';
import { getQueuedComposeCount } from '../../lib/offline-store.js';
import { getQueryClient } from '../../lib/query-client.js';
import { SessionGate } from '../auth/SessionGate.js';
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
  quotedBody?: string | undefined;
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
// Attachment types and helpers
// ---------------------------------------------------------------------------

interface AttachmentItem {
  id: string;
  filename: string;
  size: number;
  uploading?: boolean | undefined;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50 MB total

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Encode a Uint8Array to a base64 string. */
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
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
// Attachment list component
// ---------------------------------------------------------------------------

interface AttachmentListProps {
  attachments: AttachmentItem[];
  onRemove: (id: string) => void;
}

const AttachmentList = ({ attachments, onRemove }: AttachmentListProps) => {
  if (attachments.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-1.5 text-ui-xs text-text-secondary">
        <HugeiconsIcon icon={Attachment01Icon as IconSvgElement} size={12} strokeWidth={1.5} />
        <span>
          {String(attachments.length)} attachment{attachments.length !== 1 ? 's' : ''}
        </span>
      </div>
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-2 rounded-sm border border-border bg-surface/50 px-2 py-1"
        >
          <span className="min-w-0 flex-1 truncate text-ui-xs text-text-primary">
            {att.filename}
          </span>
          <span className="shrink-0 text-ui-xs text-text-secondary">
            {att.uploading ? 'Uploading...' : formatFileSize(att.size)}
          </span>
          {!att.uploading && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0"
              onClick={() => onRemove(att.id)}
              aria-label={`Remove ${att.filename}`}
            >
              <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={10} strokeWidth={1.5} />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
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
  const [subject, setSubject] = React.useState(() => {
    if (!replyTo?.subject) return '';
    // If subject already has Re:/Fwd: prefix from the caller, use as-is
    if (/^(Re|Fwd):\s/i.test(replyTo.subject)) return replyTo.subject;
    return `Re: ${replyTo.subject}`;
  });
  const [htmlBody, setHtmlBody] = React.useState(() => {
    if (!replyTo?.quotedBody) return '';
    return `<br/><blockquote style="border-left:2px solid #ccc;padding-left:8px;margin:8px 0;color:#666">${replyTo.quotedBody}</blockquote>`;
  });
  const [draftStatus, setDraftStatus] = React.useState<DraftStatus>('idle');

  // Attachment state
  const [attachments, setAttachments] = React.useState<AttachmentItem[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Encryption state
  const hasSessionKey = React.useMemo(() => !!getSessionKey(), []);

  // Offline queue count
  const [queuedCount, setQueuedCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getQueuedComposeCount().then((count) => {
        if (!cancelled) setQueuedCount(count);
      });
    };
    refresh();
    // Re-check after sends (interval covers background sync deliveries too)
    const interval = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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

  // -----------------------------------------------------------------------
  // Attachment handlers
  // -----------------------------------------------------------------------

  const handleAttachClick = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setAttachmentError(null);

      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          setAttachmentError(`"${file.name}" exceeds 25 MB limit`);
          continue;
        }

        const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
        if (totalSize + file.size > MAX_TOTAL_SIZE) {
          setAttachmentError('Total attachments exceed 50 MB limit');
          break;
        }

        // Add a placeholder while uploading
        const tempId = `uploading-${Date.now()}-${file.name}`;
        setAttachments((prev) => [
          ...prev,
          { id: tempId, filename: file.name, size: file.size, uploading: true },
        ]);

        try {
          // Read file bytes and base64-encode for upload
          const arrayBuffer = await file.arrayBuffer();
          const fileBytes = new Uint8Array(arrayBuffer);
          const fileContent = bytesToBase64(fileBytes);

          // We need a messageId to attach to — use the draft's messageId
          // If no draft exists yet, save one first
          let messageId = draftMutation.draftId;
          if (!messageId) {
            const draftResult = await new Promise<{ id: string }>((resolve, reject) => {
              draftMutation.mutate(
                {
                  to: toRecipients.length > 0 ? toRecipients : undefined,
                  subject: subject || 'Draft',
                },
                { onSuccess: resolve, onError: reject },
              );
            });
            messageId = draftResult.id;
          }

          // Upload to server (server encrypts at rest with AES-256-GCM)
          const token = getAuthToken();
          const res = await fetch('/api/compose/attachment', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              messageId,
              filename: file.name,
              mimeType: file.type || 'application/octet-stream',
              fileContent,
            }),
          });

          if (!res.ok) {
            const errBody = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(errBody?.error ?? `Upload failed: ${String(res.status)}`);
          }

          const json = (await res.json()) as {
            data: { id: string; filename: string; size: number };
          };

          // Replace placeholder with real attachment
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? { id: json.data.id, filename: json.data.filename, size: json.data.size }
                : a,
            ),
          );
        } catch (err) {
          // Remove placeholder on failure
          setAttachments((prev) => prev.filter((a) => a.id !== tempId));
          setAttachmentError(err instanceof Error ? err.message : 'Failed to upload attachment');
        }
      }

      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [attachments, draftMutation, toRecipients, subject],
  );

  const handleRemoveAttachment = React.useCallback(async (attachmentId: string) => {
    const token = getAuthToken();
    try {
      await fetch(`/api/compose/attachment/${attachmentId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // Best-effort removal from server
    }
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }, []);

  // -----------------------------------------------------------------------
  // Send handler
  // -----------------------------------------------------------------------

  const handleSend = React.useCallback(() => {
    if (!hasSessionKey || sendMutation.isPending) return;
    if (toRecipients.length === 0) return;
    if (!subject.trim()) return;

    // Collect non-uploading attachment IDs
    const attachmentIds = attachments.filter((a) => !a.uploading).map((a) => a.id);

    sendMutation.mutate(
      {
        to: toRecipients,
        cc: ccRecipients.length > 0 ? ccRecipients : undefined,
        bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
        subject,
        htmlBody: htmlBody || '<p></p>',
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      },
      {
        onSuccess: (result: SendResult) => {
          if (result.offlineQueued) {
            // Refresh queued count and stay on compose (user is offline)
            void getQueuedComposeCount().then(setQueuedCount);
            return;
          }
          // Navigate back to inbox after successful send
          window.location.href = '/mail/inbox';
        },
      },
    );
  }, [
    hasSessionKey,
    sendMutation,
    toRecipients,
    ccRecipients,
    bccRecipients,
    subject,
    htmlBody,
    attachments,
  ]);

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

  const isUploading = attachments.some((a) => a.uploading);
  const canSend =
    hasSessionKey &&
    toRecipients.length > 0 &&
    subject.trim().length > 0 &&
    !sendMutation.isPending &&
    !isUploading;

  return (
    <div className="flex h-full flex-col max-md:mobile-fullscreen max-md:bg-background">
      {/* Hidden file input for attachments */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={handleFileSelected}
      />
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
              onAttach={handleAttachClick}
            />
          </div>

          {/* Attachment list */}
          <AttachmentList attachments={attachments} onRemove={handleRemoveAttachment} />

          {/* Attachment error */}
          {attachmentError && <div className="mt-1 text-ui-xs text-danger">{attachmentError}</div>}
        </div>
      </div>

      {/* Footer bar — safe area padding on mobile for notched devices */}
      <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-3 py-1.5 max-md:pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <EncryptionStatus hasKey={hasSessionKey} />

        {queuedCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber/15 px-2 py-0.5 text-ui-xs text-amber">
            Queued ({String(queuedCount)})
          </span>
        )}

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

      {/* Offline queued toast */}
      {sendMutation.isSuccess && sendMutation.data?.offlineQueued && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 rounded-sm border border-amber bg-amber/10 px-4 py-2 text-ui-sm text-amber shadow-modal max-md:bottom-16">
          Message queued — it will be sent when you reconnect
        </div>
      )}

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
      <SessionGate>
        <ComposeViewInner replyTo={replyTo} />
      </SessionGate>
    </QueryClientProvider>
  );
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { ComposeView };
export type { ComposeViewProps, ReplyToContext };
