/**
 * Service worker registration for Enclave Mail PWA.
 *
 * Registers /sw.js, listens for updates, and dispatches a custom
 * 'sw:updated' event on the window when a new version is available.
 * UI components can listen for this event to show a refresh prompt.
 */

/**
 * Register the service worker and set up update detection.
 * Safe to call in any environment — no-ops when SW is unsupported.
 */
function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');

        // Detect when a new SW version is installed while an existing one controls the page
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // A new version is waiting — notify the UI
              window.dispatchEvent(new CustomEvent('sw:updated'));
            }
          });
        });

        // Also listen for SW_UPDATED messages from the service worker itself
        navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
          if (
            event.data &&
            typeof event.data === 'object' &&
            'type' in event.data &&
            (event.data as { type: string }).type === 'SW_UPDATED'
          ) {
            window.dispatchEvent(new CustomEvent('sw:updated'));
          }
        });
      } catch (err) {
        console.error('[Enclave] Service worker registration failed:', err);
      }
    })();
  });
}

export { registerServiceWorker };
