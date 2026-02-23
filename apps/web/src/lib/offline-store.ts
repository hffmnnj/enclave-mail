/**
 * Encrypted IndexedDB store for offline message cache and compose queue.
 *
 * All cached data is encrypted with the user's in-memory session key
 * (ChaCha20-Poly1305 via @noble/ciphers). If the session key is unavailable
 * (e.g. after page reload before re-login), cached data is inaccessible —
 * this is intentional and correct for the security model.
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'enclave-offline';
const DB_VERSION = 1;

const STORE_CACHED_MESSAGES = 'cached-messages';
const STORE_COMPOSE_QUEUE = 'compose-queue';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedMessage {
  id: string;
  mailboxId: string;
  encryptedBody: Uint8Array;
  nonce: Uint8Array;
  cachedAt: number;
}

interface QueuedCompose {
  id?: number | undefined;
  encryptedPayload: Uint8Array;
  nonce: Uint8Array;
  recipientPublicKey: string;
  queuedAt: number;
}

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

/**
 * Open (or create) the offline IndexedDB database.
 * Creates object stores on first run or version upgrade.
 */
function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CACHED_MESSAGES)) {
        db.createObjectStore(STORE_CACHED_MESSAGES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_COMPOSE_QUEUE)) {
        db.createObjectStore(STORE_COMPOSE_QUEUE, {
          keyPath: 'id',
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Encrypted message cache
// ---------------------------------------------------------------------------

/**
 * Cache a decrypted message by re-encrypting it with the session key.
 * The plaintext never touches IndexedDB — only ciphertext is stored.
 */
async function cacheDecryptedMessage(
  messageId: string,
  mailboxId: string,
  decryptedBody: string,
  sessionKey: Uint8Array,
): Promise<void> {
  const nonce = randomBytes(12);
  const cipher = chacha20poly1305(sessionKey, nonce);
  const encryptedBody = cipher.encrypt(encoder.encode(decryptedBody));

  const record: CachedMessage = {
    id: messageId,
    mailboxId,
    encryptedBody,
    nonce,
    cachedAt: Date.now(),
  };

  const db = await openOfflineDB();
  try {
    const tx = db.transaction(STORE_CACHED_MESSAGES, 'readwrite');
    tx.objectStore(STORE_CACHED_MESSAGES).put(record);
    await idbTransaction(tx);
  } finally {
    db.close();
  }
}

/**
 * Retrieve and decrypt a cached message using the session key.
 * Returns `null` if the message is not cached or decryption fails.
 */
async function getCachedMessage(messageId: string, sessionKey: Uint8Array): Promise<string | null> {
  const db = await openOfflineDB();
  try {
    const tx = db.transaction(STORE_CACHED_MESSAGES, 'readonly');
    const record = await idbRequest<CachedMessage | undefined>(
      tx.objectStore(STORE_CACHED_MESSAGES).get(messageId),
    );

    if (!record) return null;

    try {
      const cipher = chacha20poly1305(sessionKey, record.nonce);
      const plaintext = cipher.decrypt(record.encryptedBody);
      return decoder.decode(plaintext);
    } catch {
      // Decryption failure — session key mismatch or corrupted data
      return null;
    }
  } finally {
    db.close();
  }
}

/**
 * Clear all cached messages from IndexedDB.
 */
async function clearMessageCache(): Promise<void> {
  const db = await openOfflineDB();
  try {
    const tx = db.transaction(STORE_CACHED_MESSAGES, 'readwrite');
    tx.objectStore(STORE_CACHED_MESSAGES).clear();
    await idbTransaction(tx);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Compose queue
// ---------------------------------------------------------------------------

/**
 * Queue an already-encrypted compose payload for background sync delivery.
 * The payload is encrypted by the compose view before calling this function —
 * no re-encryption is needed.
 */
async function queueCompose(item: Omit<QueuedCompose, 'id' | 'queuedAt'>): Promise<void> {
  const record: Omit<QueuedCompose, 'id'> = {
    ...item,
    queuedAt: Date.now(),
  };

  const db = await openOfflineDB();
  try {
    const tx = db.transaction(STORE_COMPOSE_QUEUE, 'readwrite');
    tx.objectStore(STORE_COMPOSE_QUEUE).add(record);
    await idbTransaction(tx);
  } finally {
    db.close();
  }

  // Request background sync if the API is available
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await (
        reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }
      ).sync.register('enclave-compose-sync');
    } catch {
      // Background sync not available — items will be flushed on next online event
    }
  }
}

/**
 * Retrieve all queued compose items (for display or manual retry).
 */
async function getQueuedComposes(): Promise<QueuedCompose[]> {
  const db = await openOfflineDB();
  try {
    const tx = db.transaction(STORE_COMPOSE_QUEUE, 'readonly');
    return await idbRequest<QueuedCompose[]>(tx.objectStore(STORE_COMPOSE_QUEUE).getAll());
  } finally {
    db.close();
  }
}

/**
 * Remove a single queued compose item by its auto-incremented ID.
 */
async function removeQueuedCompose(id: number): Promise<void> {
  const db = await openOfflineDB();
  try {
    const tx = db.transaction(STORE_COMPOSE_QUEUE, 'readwrite');
    tx.objectStore(STORE_COMPOSE_QUEUE).delete(id);
    await idbTransaction(tx);
  } finally {
    db.close();
  }
}

/**
 * Clear all queued compose items.
 */
async function clearComposeQueue(): Promise<void> {
  const db = await openOfflineDB();
  try {
    const tx = db.transaction(STORE_COMPOSE_QUEUE, 'readwrite');
    tx.objectStore(STORE_COMPOSE_QUEUE).clear();
    await idbTransaction(tx);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  openOfflineDB,
  cacheDecryptedMessage,
  getCachedMessage,
  clearMessageCache,
  queueCompose,
  getQueuedComposes,
  removeQueuedCompose,
  clearComposeQueue,
};

export type { CachedMessage, QueuedCompose };
