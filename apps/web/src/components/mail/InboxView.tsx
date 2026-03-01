import { Badge, Button, ScrollArea, Skeleton } from '@enclave/ui';
import {
  Alert02Icon,
  Archive01Icon,
  Cancel01Icon,
  Delete01Icon,
  InboxIcon,
  Mail01Icon,
  MailOpen01Icon,
  Refresh01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { useMailboxes } from '../../hooks/use-mailboxes.js';
import {
  useDeleteMessage,
  useMessages,
  useMoveMessage,
  useUpdateMessageFlags,
} from '../../hooks/use-messages.js';
import { useSearch, useSearchState } from '../../hooks/use-search.js';
import { decryptField } from '../../lib/crypto-client.js';
import { getQueryClient } from '../../lib/query-client.js';
import { MessageRow } from './MessageRow.js';
import { SwipeableMessageRow } from './SwipeableMessageRow.js';

import type { MessageListItem } from '../../hooks/use-messages.js';
import type { EncryptionMetadata, KeyMaterial } from '../../lib/crypto-client.js';

// ---------------------------------------------------------------------------
// Subject decryption — client-side only
// ---------------------------------------------------------------------------

/**
 * Attempt to decrypt a base64-encoded encrypted subject using the session key.
 * Returns the decrypted string or undefined if decryption is unavailable.
 *
 * Security invariant: the private key and passphrase never leave the client.
 */
const tryDecryptSubject = (base64Subject: string): string | undefined => {
  if (typeof window === 'undefined') return undefined;

  const sessionKey = window.__enclave_session_key;
  if (!sessionKey || !(sessionKey instanceof Uint8Array)) {
    return undefined;
  }

  try {
    const keyMaterial: KeyMaterial = { sessionKey };
    const x25519PrivateKey = window.__enclave_x25519_private_key;
    if (x25519PrivateKey instanceof Uint8Array) {
      keyMaterial.x25519PrivateKey = x25519PrivateKey;
    }

    const metadata: EncryptionMetadata = { algorithm: 'chacha20-poly1305' };
    const decrypted = decryptField(base64Subject, metadata, keyMaterial);
    return decrypted ?? '[Encrypted]';
  } catch {
    return '[Encrypted]';
  }
};

// ---------------------------------------------------------------------------
// useIsMobile hook
// ---------------------------------------------------------------------------

const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
};

// ---------------------------------------------------------------------------
// Bulk action bar
// ---------------------------------------------------------------------------

interface BulkActionsProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
}

const BulkActions = ({
  selectedCount,
  totalCount,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onMarkRead,
  onMarkUnread,
  onDelete,
}: BulkActionsProps) => (
  <div className="flex h-8 items-center gap-1.5 border-b border-border bg-surface px-3">
    <input
      type="checkbox"
      checked={allSelected}
      onChange={allSelected ? onDeselectAll : onSelectAll}
      className="size-3.5 cursor-pointer rounded-sm border border-border bg-background accent-primary"
      aria-label={allSelected ? 'Deselect all messages' : 'Select all messages'}
    />
    <span className="ml-1 text-ui-xs text-text-secondary">
      {selectedCount} of {totalCount} selected
    </span>

    <div className="ml-2 flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onMarkRead}
        aria-label="Mark selected as read"
      >
        <HugeiconsIcon icon={MailOpen01Icon as IconSvgElement} size={13} strokeWidth={1.5} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onMarkUnread}
        aria-label="Mark selected as unread"
      >
        <HugeiconsIcon icon={Mail01Icon as IconSvgElement} size={13} strokeWidth={1.5} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-danger hover:text-danger"
        onClick={onDelete}
        aria-label="Delete selected messages"
      >
        <HugeiconsIcon icon={Delete01Icon as IconSvgElement} size={13} strokeWidth={1.5} />
      </Button>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const MessageSkeleton = ({ index }: { index: number }) => (
  <div
    className="flex h-9 items-center gap-2 border-b border-border px-3 md:h-9"
    style={{ opacity: 1 - index * 0.06 }}
  >
    <Skeleton className="size-3.5 rounded-sm" />
    <Skeleton className="h-3 w-3" />
    <Skeleton className="h-3 w-36 max-md:w-20" />
    <Skeleton className="h-3 flex-1" />
    <Skeleton className="h-3 w-20 max-md:hidden" />
  </div>
);

const LoadingSkeleton = () => (
  <div aria-busy="true" aria-label="Loading messages">
    {Array.from({ length: 12 }, (_, i) => (
      <MessageSkeleton key={`skeleton-${String(i)}`} index={i} />
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
    <HugeiconsIcon
      icon={InboxIcon as IconSvgElement}
      size={40}
      strokeWidth={1}
      className="mb-3 text-text-secondary/30"
    />
    <p className="text-ui-base font-medium">No messages in this mailbox</p>
    <p className="mt-1 text-ui-sm text-text-secondary/60">Messages you receive will appear here.</p>
  </div>
);

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

const ErrorState = ({ message, onRetry }: ErrorStateProps) => (
  <div className="flex flex-col items-center justify-center py-20 text-danger">
    <HugeiconsIcon
      icon={Alert02Icon as IconSvgElement}
      size={32}
      strokeWidth={1.5}
      className="mb-3"
    />
    <p className="text-ui-base font-medium">Failed to load messages</p>
    <p className="mt-1 text-ui-sm text-text-secondary">{message}</p>
    <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={onRetry}>
      <HugeiconsIcon icon={Refresh01Icon as IconSvgElement} size={13} strokeWidth={1.5} />
      Retry
    </Button>
  </div>
);

// ---------------------------------------------------------------------------
// Swipe action indicators (shown behind message row on swipe)
// ---------------------------------------------------------------------------

const SwipeArchiveIndicator = () => (
  <div className="flex h-full items-center justify-end bg-danger/80 px-4">
    <HugeiconsIcon
      icon={Archive01Icon as IconSvgElement}
      size={20}
      strokeWidth={1.5}
      className="text-white"
    />
  </div>
);

const SwipeDeleteIndicator = () => (
  <div className="flex h-full items-center justify-start bg-secondary/80 px-4">
    <HugeiconsIcon
      icon={Delete01Icon as IconSvgElement}
      size={20}
      strokeWidth={1.5}
      className="text-white"
    />
  </div>
);

// ---------------------------------------------------------------------------
// Inner inbox view (requires QueryClientProvider ancestor)
// ---------------------------------------------------------------------------

interface InboxViewInnerProps {
  mailboxId: string;
}

const InboxViewInner = ({ mailboxId }: InboxViewInnerProps) => {
  const [page, setPage] = React.useState(0);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const limit = 50;
  const isMobile = useIsMobile();

  // Search state — reads from URL params (shared with Header island)
  const {
    query: searchQuery,
    filters: searchFilters,
    clearSearch,
    isSearchActive: hasSearch,
  } = useSearchState();
  const {
    results: searchResults,
    isSearching,
    resultCount,
  } = useSearch(mailboxId, searchQuery, searchFilters);

  // Listen for URL changes from the Header island
  React.useEffect(() => {
    const handlePopState = () => {
      // Force re-render when URL changes — useSearchState reads from URL
      // This is a no-op setState that triggers the component to re-read URL params
      setPage((p) => p);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const { data, isLoading, isError, error, refetch } = useMessages(mailboxId, { page, limit });
  const updateFlags = useUpdateMessageFlags(mailboxId);
  const deleteMessage = useDeleteMessage(mailboxId);
  const moveMessage = useMoveMessage(mailboxId);
  const { data: allMailboxes } = useMailboxes();

  // Use search results when searching, otherwise use paginated messages
  const allMessages = data?.data ?? [];
  const messages = hasSearch ? searchResults : allMessages;
  const total = hasSearch ? resultCount : (data?.total ?? 0);
  const hasMore = !hasSearch && (page + 1) * limit < (data?.total ?? 0);
  const hasPrevious = !hasSearch && page > 0;

  // Decrypt subjects client-side
  const decryptedSubjects = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const msg of messages) {
      if (msg.subjectEncrypted) {
        const decrypted = tryDecryptSubject(msg.subjectEncrypted);
        if (decrypted) {
          map.set(msg.id, decrypted);
        }
      }
    }
    return map;
  }, [messages]);

  // Selection handlers
  const allSelected = messages.length > 0 && messages.every((m) => selectedIds.has(m.id));

  const handleSelect = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = React.useCallback(() => {
    setSelectedIds(new Set(messages.map((m) => m.id)));
  }, [messages]);

  const handleDeselectAll = React.useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Bulk actions
  const handleMarkRead = React.useCallback(() => {
    for (const id of selectedIds) {
      updateFlags.mutate({ messageId: id, flags: { seen: true } });
    }
    setSelectedIds(new Set());
  }, [selectedIds, updateFlags]);

  const handleMarkUnread = React.useCallback(() => {
    for (const id of selectedIds) {
      updateFlags.mutate({ messageId: id, flags: { seen: false } });
    }
    setSelectedIds(new Set());
  }, [selectedIds, updateFlags]);

  const handleDelete = React.useCallback(() => {
    for (const id of selectedIds) {
      deleteMessage.mutate(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, deleteMessage]);

  // Navigate to message
  const handleMessageClick = React.useCallback((message: MessageListItem) => {
    window.location.href = `/mail/message/${message.id}`;
  }, []);

  // Swipe actions (mobile only)
  const handleSwipeArchive = React.useCallback(
    (messageId: string) => {
      const archiveMailbox = allMailboxes?.find((m) => m.type === 'archive');
      if (!archiveMailbox) return;
      moveMessage.mutate({ messageId, targetMailboxId: archiveMailbox.id });
    },
    [allMailboxes, moveMessage],
  );

  const handleSwipeDelete = React.useCallback(
    (messageId: string) => {
      deleteMessage.mutate(messageId);
    },
    [deleteMessage],
  );

  // Clear selection when navigating pages
  const prevPageRef = React.useRef(page);
  if (prevPageRef.current !== page) {
    prevPageRef.current = page;
    if (selectedIds.size > 0) {
      setSelectedIds(new Set());
    }
  }

  // Loading state (for initial load, not search)
  if (isLoading && !hasSearch) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (isError && !hasSearch) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'An unexpected error occurred'}
        onRetry={() => void refetch()}
      />
    );
  }

  // Empty state — no messages at all
  if (messages.length === 0 && !hasSearch) {
    return <EmptyState />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search results banner */}
      {hasSearch && (
        <div className="flex h-8 items-center gap-2 border-b border-primary/20 bg-primary/5 px-3">
          <HugeiconsIcon
            icon={Search01Icon as IconSvgElement}
            size={13}
            strokeWidth={1.5}
            className="shrink-0 text-primary"
          />
          {isSearching ? (
            <span className="text-ui-xs text-text-secondary">Searching...</span>
          ) : (
            <span className="text-ui-xs text-text-primary">
              {searchQuery && (
                <>
                  Results for{' '}
                  <span className="font-medium font-mono">&ldquo;{searchQuery}&rdquo;</span>
                </>
              )}
              {!searchQuery && 'Filtered results'}
            </span>
          )}
          <Badge variant="outline" className="font-mono">
            {resultCount} result{resultCount !== 1 ? 's' : ''}
          </Badge>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-ui-xs"
            onClick={clearSearch}
          >
            <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={11} strokeWidth={1.5} />
            Clear search
          </Button>
        </div>
      )}

      {/* Bulk actions bar — visible when messages are selected */}
      {selectedIds.size > 0 && (
        <BulkActions
          selectedCount={selectedIds.size}
          totalCount={messages.length}
          allSelected={allSelected}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onMarkRead={handleMarkRead}
          onMarkUnread={handleMarkUnread}
          onDelete={handleDelete}
        />
      )}

      {/* Select-all row when nothing is selected */}
      {selectedIds.size === 0 && (
        <div className="flex h-7 items-center gap-1.5 border-b border-border bg-surface/50 px-3">
          <input
            type="checkbox"
            checked={false}
            onChange={handleSelectAll}
            className="size-3.5 cursor-pointer rounded-sm border border-border bg-background accent-primary"
            aria-label="Select all messages"
          />
          <span className="text-ui-xs text-text-secondary/60">
            {total} message{total !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Message list */}
      <ScrollArea className="flex-1">
        {messages.length === 0 && hasSearch ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
            <HugeiconsIcon
              icon={Search01Icon as IconSvgElement}
              size={32}
              strokeWidth={1}
              className="mb-3 text-text-secondary/30"
            />
            <p className="text-ui-base font-medium">No messages found</p>
            <p className="mt-1 text-ui-sm text-text-secondary/60">
              Try adjusting your search or filters.
            </p>
            <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={clearSearch}>
              <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={13} strokeWidth={1.5} />
              Clear search
            </Button>
          </div>
        ) : (
          <ul className="list-none p-0" aria-label="Message list">
            {messages.map((message) =>
              isMobile ? (
                <SwipeableMessageRow
                  key={message.id}
                  message={message}
                  decryptedSubject={decryptedSubjects.get(message.id) ?? undefined}
                  isSelected={selectedIds.has(message.id)}
                  onSelect={handleSelect}
                  onClick={() => handleMessageClick(message)}
                  onSwipeLeft={() => handleSwipeArchive(message.id)}
                  onSwipeRight={() => handleSwipeDelete(message.id)}
                  leftIndicator={<SwipeArchiveIndicator />}
                  rightIndicator={<SwipeDeleteIndicator />}
                />
              ) : (
                <MessageRow
                  key={message.id}
                  message={message}
                  decryptedSubject={decryptedSubjects.get(message.id) ?? undefined}
                  isSelected={selectedIds.has(message.id)}
                  onSelect={handleSelect}
                  onClick={() => handleMessageClick(message)}
                />
              ),
            )}
          </ul>
        )}
      </ScrollArea>

      {/* Pagination */}
      {(hasPrevious || hasMore) && (
        <div className="flex h-8 items-center justify-between border-t border-border bg-surface/50 px-3">
          <span className="text-ui-xs text-text-secondary font-mono">
            {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-ui-xs"
              disabled={!hasPrevious}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-ui-xs"
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Public component — wraps with QueryClientProvider for React island isolation
// ---------------------------------------------------------------------------

interface InboxViewProps {
  mailboxId: string;
}

const InboxView = ({ mailboxId }: InboxViewProps) => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <InboxViewInner mailboxId={mailboxId} />
    </QueryClientProvider>
  );
};

export { InboxView };
export type { InboxViewProps };
