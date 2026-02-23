import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types — mirrors the server API response shapes
// ---------------------------------------------------------------------------

interface MessageFlags {
  seen: boolean;
  flagged: boolean;
  deleted: boolean;
  draft: boolean;
}

interface MessageListItem {
  id: string;
  uid: number;
  messageId: string | null;
  fromAddress: string;
  toAddresses: string[];
  subjectEncrypted: string | null;
  date: string;
  flags: MessageFlags;
  size: number;
  dkimStatus: string | null;
  spfStatus: string | null;
  dmarcStatus: string | null;
}

interface PaginatedMessages {
  data: MessageListItem[];
  total: number;
  offset: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const getApiBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) {
    return import.meta.env.PUBLIC_API_URL as string;
  }
  return 'http://localhost:3001';
};

const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('enclave:sessionToken');
  } catch {
    return null;
  }
};

const authHeaders = (): HeadersInit => {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const fetchMessages = async (
  mailboxId: string,
  offset: number,
  limit: number,
): Promise<PaginatedMessages> => {
  const base = getApiBaseUrl();
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });

  const res = await fetch(`${base}/mailboxes/${mailboxId}/messages?${params.toString()}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch messages: ${String(res.status)}`);
  }

  return (await res.json()) as PaginatedMessages;
};

// ---------------------------------------------------------------------------
// Query hook — paginated message list with background refresh
// ---------------------------------------------------------------------------

interface UseMessagesOptions {
  page?: number;
  limit?: number;
  enabled?: boolean;
}

const useMessages = (mailboxId: string, options?: UseMessagesOptions) => {
  const page = options?.page ?? 0;
  const limit = options?.limit ?? 50;
  const offset = page * limit;

  return useQuery({
    queryKey: ['messages', mailboxId, page, limit] as const,
    queryFn: () => fetchMessages(mailboxId, offset, limit),
    refetchInterval: 30_000,
    enabled: options?.enabled !== false && !!mailboxId,
    staleTime: 15_000,
  });
};

// ---------------------------------------------------------------------------
// Mutation — update message flags
// ---------------------------------------------------------------------------

interface UpdateFlagsInput {
  messageId: string;
  flags: Partial<MessageFlags>;
}

const useUpdateMessageFlags = (mailboxId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, flags }: UpdateFlagsInput) => {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/messages/${messageId}/flags`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ flags }),
      });

      if (!res.ok) {
        throw new Error(`Failed to update flags: ${String(res.status)}`);
      }

      return (await res.json()) as { data: { flags: MessageFlags } };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', mailboxId] });
    },
  });
};

// ---------------------------------------------------------------------------
// Mutation — delete message (move to trash or permanent delete)
// ---------------------------------------------------------------------------

const useDeleteMessage = (mailboxId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/messages/${messageId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });

      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to delete message: ${String(res.status)}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', mailboxId] });
    },
  });
};

// ---------------------------------------------------------------------------
// Mutation — move message to another mailbox
// ---------------------------------------------------------------------------

interface MoveMessageInput {
  messageId: string;
  targetMailboxId: string;
}

const useMoveMessage = (mailboxId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, targetMailboxId }: MoveMessageInput) => {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/messages/${messageId}/move`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ targetMailboxId }),
      });

      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to move message: ${String(res.status)}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', mailboxId] });
    },
  });
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { useMessages, useUpdateMessageFlags, useDeleteMessage, useMoveMessage };
export type {
  MessageFlags,
  MessageListItem,
  PaginatedMessages,
  UseMessagesOptions,
  UpdateFlagsInput,
  MoveMessageInput,
};
