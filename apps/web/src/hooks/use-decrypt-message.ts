import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { getApiClient } from '../lib/api-client.js';
import { decryptField } from '../lib/crypto-client.js';

import type { EncryptionMetadata, KeyMaterial } from '../lib/crypto-client.js';

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

const resolveEncryptionMetadata = (
  encryptionMetadata?: Record<string, unknown>,
): EncryptionMetadata => {
  if (encryptionMetadata?.algorithm === 'x25519-chacha20poly1305') {
    return encryptionMetadata as EncryptionMetadata;
  }

  if (encryptionMetadata?.algorithm === 'chacha20-poly1305') {
    const version =
      typeof encryptionMetadata.version === 'number' ? encryptionMetadata.version : undefined;

    if (version !== undefined) {
      return {
        algorithm: 'chacha20-poly1305',
        version,
      };
    }

    return {
      algorithm: 'chacha20-poly1305',
    };
  }

  return { algorithm: 'chacha20-poly1305' };
};

const tryDecryptField = (
  base64Encrypted: string,
  encryptionMetadata?: Record<string, unknown>,
): string | undefined => {
  if (typeof window === 'undefined') return undefined;

  const sessionKey = window.__enclave_session_key;
  if (!sessionKey || !(sessionKey instanceof Uint8Array)) {
    return undefined;
  }

  try {
    const x25519PrivateKey = window.__enclave_x25519_private_key;
    const keyMaterial: KeyMaterial = { sessionKey };
    if (x25519PrivateKey instanceof Uint8Array) {
      keyMaterial.x25519PrivateKey = x25519PrivateKey;
    }

    const metadata = resolveEncryptionMetadata(encryptionMetadata);
    const decrypted = decryptField(base64Encrypted, metadata, keyMaterial);
    return decrypted ?? '[Encrypted]';
  } catch {
    return '[Encrypted]';
  }
};

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
        decryptedBody = tryDecryptField(
          message.body.encryptedBody,
          message.body.encryptionMetadata,
        );
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
