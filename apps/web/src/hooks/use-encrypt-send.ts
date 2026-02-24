import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { getApiClient } from '../lib/api-client.js';
import { useMailboxes } from './use-mailboxes.js';
import type { PaginatedMessages } from './use-messages.js';

type RpcResponse<T> = {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
};
// ---------------------------------------------------------------------------
// Types — mirrors the server compose API response shapes
// ---------------------------------------------------------------------------

interface SendPayload {
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  encryptedSubject: string;
  encryptedBody: string;
  mimeBody: string;
  encryptionMetadata: {
    algorithm: string;
    recipientKeyFingerprints?: string[] | undefined;
    version?: number | undefined;
  };
}

interface SendResult {
  messageId: string;
  status: 'queued';
}

interface DraftPayload {
  to?: string[] | undefined;
  cc?: string[] | undefined;
  subject?: string | undefined;
  encryptedBody?: string | undefined;
  encryptionMetadata?:
    | {
        algorithm: string;
        recipientKeyFingerprints?: string[] | undefined;
        version?: number | undefined;
      }
    | undefined;
}

interface DraftResult {
  id: string;
}

interface ApiResponse<T> {
  data: T;
}

type ComposeApiClient = {
  compose: {
    send: {
      $post: (
        input: { json: SendPayload },
        options: { headers: HeadersInit; signal?: AbortSignal },
      ) => Promise<RpcResponse<ApiResponse<SendResult>>>;
    };
    draft: {
      $post: (
        input: { json: DraftPayload },
        options: { headers: HeadersInit; signal?: AbortSignal },
      ) => Promise<RpcResponse<ApiResponse<DraftResult>>>;
      ':id': {
        $put: (
          input: { param: { id: string }; json: DraftPayload },
          options: { headers: HeadersInit; signal?: AbortSignal },
        ) => Promise<RpcResponse<ApiResponse<DraftResult>>>;
      };
    };
  };
};

// ---------------------------------------------------------------------------
// API helpers (same pattern as use-messages.ts)
// ---------------------------------------------------------------------------

const api = getApiClient() as ComposeApiClient;

const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('enclave:sessionToken');
  } catch {
    return null;
  }
};

const getCurrentUserEmail = (): string => {
  if (typeof window === 'undefined') return 'me@localhost';
  try {
    return localStorage.getItem('enclave:userEmail') ?? 'me@localhost';
  } catch {
    return 'me@localhost';
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
// Client-side encryption helpers
// ---------------------------------------------------------------------------

/** Encode a Uint8Array to a base64 string. */
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
};

/** Encode a UTF-8 string to Uint8Array. */
const stringToBytes = (str: string): Uint8Array => {
  return new TextEncoder().encode(str);
};

/**
 * Encrypt plaintext bytes using ChaCha20-Poly1305 with the session key.
 *
 * Returns the concatenation of [nonce (12B) | ciphertext + tag] as base64.
 *
 * Security invariant: encryption happens entirely client-side.
 * The server never receives plaintext content.
 */
const encryptField = async (plaintext: Uint8Array, sessionKey: Uint8Array): Promise<string> => {
  // Dynamic import to keep the crypto bundle lazy-loaded
  const { chacha20poly1305 } = await import('@noble/ciphers/chacha.js');
  const { randomBytes } = await import('@noble/ciphers/utils.js');

  const nonce = randomBytes(12);
  const cipher = chacha20poly1305(sessionKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  // Concatenate nonce + ciphertext for storage
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);

  return bytesToBase64(combined);
};

/**
 * Get the session key from the global window object.
 * Returns undefined if unavailable (user not authenticated or key not derived).
 */
const getSessionKey = (): Uint8Array | undefined => {
  if (typeof window === 'undefined') return undefined;
  const key = window.__enclave_session_key;
  if (!key || !(key instanceof Uint8Array)) return undefined;
  return key;
};

// ---------------------------------------------------------------------------
// Global augmentation for session key (shared with InboxView, ThreadView)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __enclave_session_key?: Uint8Array;
  }
}

// ---------------------------------------------------------------------------
// Compose input types
// ---------------------------------------------------------------------------

interface ComposeInput {
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject: string;
  htmlBody: string;
}

// ---------------------------------------------------------------------------
// Hook: useEncryptSend
// ---------------------------------------------------------------------------

/**
 * TanStack Query mutation that encrypts subject + body client-side,
 * then POSTs to /compose/send. On success, invalidates the messages
 * query cache so the Sent mailbox reflects the new message.
 *
 * Security invariant: the server receives only ciphertext — never
 * plaintext subject or body content.
 */
const useEncryptSend = () => {
  const queryClient = useQueryClient();
  const { data: mailboxes } = useMailboxes();

  const sentMailboxId = React.useMemo(
    () => mailboxes?.find((mailbox) => mailbox.type === 'sent')?.id,
    [mailboxes],
  );

  return useMutation({
    mutationFn: async (input: ComposeInput): Promise<SendResult> => {
      const sessionKey = getSessionKey();
      if (!sessionKey) {
        throw new Error('Encryption unavailable — please re-authenticate');
      }

      // Encrypt subject and body client-side
      const [encryptedSubject, encryptedBody] = await Promise.all([
        encryptField(stringToBytes(input.subject), sessionKey),
        encryptField(stringToBytes(input.htmlBody), sessionKey),
      ]);

      const payload: SendPayload = {
        to: input.to,
        cc: input.cc?.length ? input.cc : undefined,
        bcc: input.bcc?.length ? input.bcc : undefined,
        encryptedSubject,
        encryptedBody,
        mimeBody: input.htmlBody,
        encryptionMetadata: {
          algorithm: 'chacha20-poly1305',
          version: 1,
        },
      };

      const res = await api.compose.send.$post(
        {
          json: payload,
        },
        {
          headers: authHeaders(),
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(errorBody?.error ?? `Send failed: ${String(res.status)}`);
      }

      const json = (await res.json()) as ApiResponse<SendResult>;
      return json.data;
    },
    onMutate: async (input: ComposeInput) => {
      if (!sentMailboxId) {
        return {
          previousMessages: [] as Array<[readonly unknown[], PaginatedMessages | undefined]>,
        };
      }

      await queryClient.cancelQueries({ queryKey: ['messages', sentMailboxId] });

      const previousMessages = queryClient.getQueriesData<PaginatedMessages>({
        queryKey: ['messages', sentMailboxId],
      }) as Array<[readonly unknown[], PaginatedMessages | undefined]>;

      if (previousMessages.length === 0) {
        return { previousMessages };
      }

      const sessionKey = getSessionKey();
      if (!sessionKey) {
        return { previousMessages };
      }

      const subjectEncrypted = await encryptField(stringToBytes(input.subject), sessionKey);

      const optimisticMessage = {
        id: `optimistic-${Date.now()}`,
        uid: 0,
        messageId: null,
        fromAddress: getCurrentUserEmail(),
        toAddresses: input.to,
        subjectEncrypted,
        date: new Date().toISOString(),
        flags: { seen: true, flagged: false, deleted: false, draft: false },
        size: 0,
        dkimStatus: null,
        spfStatus: null,
        dmarcStatus: null,
      };

      for (const [queryKey] of previousMessages) {
        queryClient.setQueryData<PaginatedMessages>(queryKey, (old) => ({
          data: [optimisticMessage, ...(old?.data ?? [])],
          total: (old?.total ?? 0) + 1,
          offset: old?.offset ?? 0,
          limit: old?.limit ?? 50,
        }));
      }

      return { previousMessages };
    },
    onError: (_err, _input, context) => {
      if (!context?.previousMessages) {
        return;
      }

      for (const [queryKey, previous] of context.previousMessages) {
        queryClient.setQueryData(queryKey, previous);
      }
    },
    onSettled: () => {
      if (sentMailboxId) {
        void queryClient.invalidateQueries({ queryKey: ['messages', sentMailboxId] });
      }

      void queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
};

// ---------------------------------------------------------------------------
// Hook: useSaveDraft
// ---------------------------------------------------------------------------

interface DraftInput {
  to?: string[] | undefined;
  cc?: string[] | undefined;
  subject?: string | undefined;
  htmlBody?: string | undefined;
}

/**
 * TanStack Query mutation that saves or updates a draft.
 * Tracks the draftId internally so subsequent calls update
 * the existing draft rather than creating new ones.
 *
 * The draft body is encrypted client-side before sending to the server.
 */
const useSaveDraft = () => {
  const queryClient = useQueryClient();
  const draftIdRef = React.useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: DraftInput): Promise<DraftResult> => {
      const sessionKey = getSessionKey();

      let encryptedBody: string | undefined;
      if (input.htmlBody && sessionKey) {
        encryptedBody = await encryptField(stringToBytes(input.htmlBody), sessionKey);
      }

      const payload: DraftPayload = {
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        encryptedBody,
        encryptionMetadata: sessionKey ? { algorithm: 'chacha20-poly1305', version: 1 } : undefined,
      };

      const existingId = draftIdRef.current;

      const res = existingId
        ? await api.compose.draft[':id'].$put(
            {
              param: { id: existingId },
              json: payload,
            },
            {
              headers: authHeaders(),
              signal: AbortSignal.timeout(15_000),
            },
          )
        : await api.compose.draft.$post(
            {
              json: payload,
            },
            {
              headers: authHeaders(),
              signal: AbortSignal.timeout(15_000),
            },
          );

      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(errorBody?.error ?? `Draft save failed: ${String(res.status)}`);
      }

      const json = (await res.json()) as ApiResponse<DraftResult>;
      draftIdRef.current = json.data.id;
      return json.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  const resetDraftId = React.useCallback(() => {
    draftIdRef.current = null;
  }, []);

  return {
    ...mutation,
    draftId: draftIdRef.current,
    resetDraftId,
  };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { useEncryptSend, useSaveDraft, getSessionKey };
export type { ComposeInput, DraftInput, SendResult, DraftResult };
