// Enclave Mail — Service Worker
// Cache-first app shell, stale-while-revalidate API, background sync for compose queue.
// Plain JS — Astro does not process files in public/.

const SHELL_CACHE = 'enclave-shell-v1';
const API_CACHE = 'enclave-api-v1';

// App shell resources to pre-cache on install
const SHELL_URLS = ['/', '/mail/inbox'];

// ---------------------------------------------------------------------------
// Install — pre-cache app shell
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_URLS).catch((err) => {
        // Non-fatal: some URLs may not exist yet during development
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }),
  );
  // Activate immediately — don't wait for old SW to release clients
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — claim clients, clean stale caches
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
  const KNOWN_CACHES = new Set([SHELL_CACHE, API_CACHE]);

  event.waitUntil(
    caches
      .keys()
      .then((names) => {
        return Promise.all(
          names.filter((name) => !KNOWN_CACHES.has(name)).map((name) => caches.delete(name)),
        );
      })
      .then(() => self.clients.claim()),
  );

  // Notify all clients that a new SW version is active
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) {
      client.postMessage({ type: 'SW_UPDATED' });
    }
  });
});

// ---------------------------------------------------------------------------
// Fetch — cache-first for shell, stale-while-revalidate for API GETs
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API routes — stale-while-revalidate (GET only)
  if (url.pathname.startsWith('/api/') && event.request.method === 'GET') {
    event.respondWith(staleWhileRevalidate(event.request, API_CACHE));
    return;
  }

  // Navigation and static assets — cache-first
  if (event.request.method === 'GET') {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }
});

/**
 * Cache-first: return cached response if available, otherwise fetch from network
 * and cache the response for next time.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    // Offline and not cached — return a basic offline fallback for navigations
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Stale-while-revalidate: return cached response immediately, then update
 * the cache from the network in the background.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Fire off network fetch in background (don't await for response)
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Return cached immediately if available, otherwise wait for network
  if (cached) return cached;

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// ---------------------------------------------------------------------------
// Background Sync — flush compose queue
// ---------------------------------------------------------------------------

self.addEventListener('sync', (event) => {
  if (event.tag === 'enclave-compose-sync') {
    event.waitUntil(flushComposeQueue());
  }
});

/**
 * Read queued compose items from IndexedDB and POST each to the send endpoint.
 * Successfully sent items are removed from the queue; failures remain for retry.
 */
async function flushComposeQueue() {
  let db;
  try {
    db = await openDB();
  } catch (_err) {
    console.error('[SW] Cannot open IndexedDB for compose sync');
    return;
  }

  const items = await getAllFromStore(db, 'compose-queue');
  if (!items.length) return;

  for (const item of items) {
    try {
      const response = await fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedPayload: Array.from(item.encryptedPayload),
          nonce: Array.from(item.nonce),
          recipientPublicKey: item.recipientPublicKey,
        }),
      });

      if (response.ok) {
        await deleteFromStore(db, 'compose-queue', item.id);
      }
      // Non-ok responses: leave in queue for next sync attempt
    } catch (_err) {
      // Network error: leave in queue for next sync attempt
      console.warn('[SW] Compose sync failed for item', item.id, '— will retry');
    }
  }
}

// ---------------------------------------------------------------------------
// IndexedDB helpers (minimal — SW cannot import TypeScript modules)
// ---------------------------------------------------------------------------

const DB_NAME = 'enclave-offline';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('cached-messages')) {
        db.createObjectStore('cached-messages', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('compose-queue')) {
        db.createObjectStore('compose-queue', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function deleteFromStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
