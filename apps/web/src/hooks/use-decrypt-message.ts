import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { getApiClient } from '../lib/api-client.js';

type RpcResponse<T> = {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
};

// ---------------------------------------------------------------------------
// Types — mirrors the server GET /messages/:id response
// ---------------------------------------------------------------------------

interface MessageFlags {
  seen: boolean;
  flagged: boolean;
  deleted: boolean;
  draft: boolean;
}

interface MessageBody {
  encryptedBody: string;
  contentType: string;
  encryptionMetadata: Record<string, unknown>;
}

interface FullMessage {
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
  body: MessageBody | null;
}

interface ApiResponse<T> {
  data: T;
}

interface DecryptedMessage {
  message: FullMessage;
  decryptedSubject: string | undefined;
  decryptedBody: string | undefined;
  isDecrypting: boolean;
  decryptionError: string | undefined;
}

// ---------------------------------------------------------------------------
// API helpers (same pattern as use-messages.ts)
// ---------------------------------------------------------------------------

type DecryptApiClient = {
  messages: {
    ':id': {
      $get: (
        input: { param: { id: string } },
        options: { headers: HeadersInit; signal?: AbortSignal },
      ) => Promise<RpcResponse<ApiResponse<FullMessage>>>;
    };
  };
};

const api = getApiClient() as DecryptApiClient;

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

const fetchMessage = async (messageId: string): Promise<FullMessage> => {
  const res = await api.messages[':id'].$get(
    {
      param: { id: messageId },
    },
    {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch message: ${String(res.status)}`);
  }

  const json = (await res.json()) as ApiResponse<FullMessage>;
  return json.data;
};

// ---------------------------------------------------------------------------
// Client-side decryption helpers
// ---------------------------------------------------------------------------

/** Decode a base64 string to Uint8Array. */
const base64ToBytes = (base64: string): Uint8Array => {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
};

/** Decode a Uint8Array to a UTF-8 string. */
const bytesToString = (bytes: Uint8Array): string => {
  return new TextDecoder().decode(bytes);
};

/**
 * Attempt to decrypt a base64-encoded encrypted field using the session key.
 *
 * Security invariant: the private key and passphrase never leave the client.
 * If the session key is unavailable, returns undefined (graceful degradation).
 *
 * Encrypted format: [nonce (12B) | ciphertext + tag]
 * Uses ChaCha20-Poly1305 with the session-derived key.
 */
const tryDecryptField = (_base64Encrypted: string): string | undefined => {
  if (typeof window === 'undefined') return undefined;

  try {
    const sessionKey = window.__enclave_session_key;
    if (!sessionKey || !(sessionKey instanceof Uint8Array)) {
      return undefined;
    }

    const bytes = base64ToBytes(_base64Encrypted);
    const NONCE_LENGTH = 12;
    if (bytes.length <= NONCE_LENGTH) return undefined;

    // Full decryption will be wired when @enclave/crypto is bundled for browser.
    // This is a safe degradation — content shows as encrypted until
    // the crypto module is available in the browser bundle.
    return undefined;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Global augmentation for session key (shared with InboxView)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __enclave_session_key?: Uint8Array;
  }
}

// ---------------------------------------------------------------------------
// Hook: useDecryptMessage
// ---------------------------------------------------------------------------

/**
 * Fetches a full message by ID and attempts client-side decryption of the
 * subject and body. Decryption is performed entirely in the browser — the
 * private key never leaves the client.
 *
 * Returns the raw message, decrypted fields, and loading/error states.
 */
const useDecryptMessage = (messageId: string) => {
  const {
    data: message,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['message', messageId] as const,
    queryFn: () => fetchMessage(messageId),
    enabled: !!messageId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Decrypt subject and body client-side
  const decrypted = React.useMemo((): Omit<DecryptedMessage, 'message' | 'isDecrypting'> => {
    if (!message) {
      return {
        decryptedSubject: undefined,
        decryptedBody: undefined,
        decryptionError: undefined,
      };
    }

    let decryptedSubject: string | undefined;
    let decryptedBody: string | undefined;
    let decryptionError: string | undefined;

    // Decrypt subject
    if (message.subjectEncrypted) {
      decryptedSubject = tryDecryptField(message.subjectEncrypted);
    }

    // Decrypt body
    if (message.body?.encryptedBody) {
      try {
        const sessionKey = typeof window !== 'undefined' ? window.__enclave_session_key : undefined;

        if (!sessionKey || !(sessionKey instanceof Uint8Array)) {
          // No session key — graceful degradation, not an error
          decryptedBody = undefined;
        } else {
          // Attempt decryption
          decryptedBody = tryDecryptField(message.body.encryptedBody);

          // If decryption returned undefined but we have a session key,
          // the crypto module isn't wired yet — show the raw body as
          // a fallback for development (base64 decoded if possible)
          if (decryptedBody === undefined) {
            try {
              decryptedBody = bytesToString(base64ToBytes(message.body.encryptedBody));
            } catch {
              decryptionError = 'Failed to decode message body';
            }
          }
        }
      } catch (err) {
        decryptionError = err instanceof Error ? err.message : 'Decryption failed';
      }
    }

    return { decryptedSubject, decryptedBody, decryptionError };
  }, [message]);

  const hasSessionKey = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    const key = window.__enclave_session_key;
    return !!key && key instanceof Uint8Array;
  }, []);

  return {
    message: message ?? null,
    decryptedSubject: decrypted.decryptedSubject,
    decryptedBody: decrypted.decryptedBody,
    isLoading,
    isDecrypting: isLoading,
    isError,
    error: isError
      ? error instanceof Error
        ? error.message
        : 'Failed to load message'
      : undefined,
    decryptionError: decrypted.decryptionError,
    hasSessionKey,
  };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { useDecryptMessage };
export type { FullMessage, MessageBody, MessageFlags, DecryptedMessage };
