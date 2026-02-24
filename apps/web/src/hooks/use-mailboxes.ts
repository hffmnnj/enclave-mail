import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getApiClient } from '../lib/api-client.js';

type RpcResponse<T> = {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
};

// ---------------------------------------------------------------------------
// Types — mirrors the server mailbox API response shapes
// ---------------------------------------------------------------------------

type MailboxType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive' | 'custom';

interface Mailbox {
  id: string;
  name: string;
  type: MailboxType;
  messageCount: number;
  unreadCount: number;
  uidNext: number;
}

interface MailboxCreated {
  id: string;
  name: string;
}

interface ApiResponse<T> {
  data: T;
}

// ---------------------------------------------------------------------------
// System mailbox types that cannot be deleted
// ---------------------------------------------------------------------------

const SYSTEM_MAILBOX_TYPES = new Set<MailboxType>(['inbox', 'sent', 'drafts', 'trash', 'archive']);

// ---------------------------------------------------------------------------
// API helpers (same pattern as use-messages.ts)
// ---------------------------------------------------------------------------

type MailboxesApiClient = {
  mailboxes: {
    $get: (
      input: Record<string, never>,
      options: { headers: HeadersInit; signal?: AbortSignal },
    ) => Promise<RpcResponse<ApiResponse<Mailbox[]>>>;
    $post: (
      input: { json: { name: string } },
      options: { headers: HeadersInit },
    ) => Promise<RpcResponse<ApiResponse<MailboxCreated>>>;
    ':id': {
      $delete: (
        input: { param: { id: string } },
        options: { headers: HeadersInit },
      ) => Promise<RpcResponse<unknown>>;
    };
  };
};

const api = getApiClient() as MailboxesApiClient;

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

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const fetchMailboxes = async (): Promise<Mailbox[]> => {
  const res = await api.mailboxes.$get(
    {},
    {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch mailboxes: ${String(res.status)}`);
  }

  const body = (await res.json()) as ApiResponse<Mailbox[]>;
  return body.data;
};

const createMailboxRequest = async (name: string): Promise<MailboxCreated> => {
  const res = await api.mailboxes.$post(
    {
      json: { name },
    },
    {
      headers: authHeaders(),
    },
  );

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    const message = errorBody?.error ?? `Failed to create mailbox: ${String(res.status)}`;
    throw new Error(message);
  }

  const body = (await res.json()) as ApiResponse<MailboxCreated>;
  return body.data;
};

const deleteMailboxRequest = async (id: string): Promise<void> => {
  const res = await api.mailboxes[':id'].$delete(
    {
      param: { id },
    },
    {
      headers: authHeaders(),
    },
  );

  if (!res.ok && res.status !== 204) {
    const errorBody = (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    const message = errorBody?.error ?? `Failed to delete mailbox: ${String(res.status)}`;
    throw new Error(message);
  }
};

// ---------------------------------------------------------------------------
// Query hook — list all mailboxes with counts
// ---------------------------------------------------------------------------

const useMailboxes = () => {
  return useQuery({
    queryKey: ['mailboxes'] as const,
    queryFn: fetchMailboxes,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
};

// ---------------------------------------------------------------------------
// Mutation — create a custom mailbox (optimistic)
// ---------------------------------------------------------------------------

const useCreateMailbox = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => createMailboxRequest(name),
    onMutate: async (name: string) => {
      await queryClient.cancelQueries({ queryKey: ['mailboxes'] });
      const previous = queryClient.getQueryData<Mailbox[]>(['mailboxes']);

      // Optimistic add with temporary id
      const optimistic: Mailbox = {
        id: `temp-${Date.now()}`,
        name,
        type: 'custom',
        messageCount: 0,
        unreadCount: 0,
        uidNext: 1,
      };

      queryClient.setQueryData<Mailbox[]>(['mailboxes'], (old) =>
        old ? [...old, optimistic] : [optimistic],
      );

      return { previous };
    },
    onError: (_err, _name, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['mailboxes'], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
  });
};

// ---------------------------------------------------------------------------
// Mutation — delete a custom mailbox (optimistic)
// ---------------------------------------------------------------------------

const useDeleteMailbox = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteMailboxRequest(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['mailboxes'] });
      const previous = queryClient.getQueryData<Mailbox[]>(['mailboxes']);

      queryClient.setQueryData<Mailbox[]>(['mailboxes'], (old) =>
        old ? old.filter((m) => m.id !== id) : [],
      );

      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['mailboxes'], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
  });
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const isSystemMailbox = (type: MailboxType): boolean => SYSTEM_MAILBOX_TYPES.has(type);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { useMailboxes, useCreateMailbox, useDeleteMailbox, isSystemMailbox, SYSTEM_MAILBOX_TYPES };
export type { Mailbox, MailboxType, MailboxCreated };
