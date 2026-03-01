import * as React from 'react';

const DISMISSED_KEY = 'enclave:pushDismissed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const PushPermissionPrompt = (): React.ReactElement | null => {
  const [visible, setVisible] = React.useState(false);
  const [subscribing, setSubscribing] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;

    setVisible(true);
  }, []);

  const handleEnable = React.useCallback(async () => {
    setSubscribing(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setVisible(false);
        return;
      }

      const vapidRes = await fetch('/api/push/vapid-key');
      if (!vapidRes.ok) {
        console.warn('[push] Failed to fetch VAPID key');
        setVisible(false);
        return;
      }
      const { publicKey } = (await vapidRes.json()) as { publicKey: string };

      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });

      const subJson = subscription.toJSON();
      const keys = subJson.keys as { p256dh: string; auth: string } | undefined;

      if (!subJson.endpoint || !keys?.p256dh || !keys?.auth) {
        console.warn('[push] Subscription missing required fields');
        setVisible(false);
        return;
      }

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        }),
      });

      setVisible(false);
    } catch (err) {
      console.warn('[push] Subscription failed:', err);
    } finally {
      setSubscribing(false);
    }
  }, []);

  const handleDismiss = React.useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className="mx-4 mt-3 mb-1 flex items-center gap-3 rounded-lg border border-border-primary bg-bg-secondary px-4 py-3 text-ui-sm">
      <span className="flex-1 text-text-primary">
        Enable notifications to get alerted when new mail arrives.
      </span>
      <button
        type="button"
        onClick={handleEnable}
        disabled={subscribing}
        className="rounded-md bg-accent-primary px-3 py-1.5 text-ui-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {subscribing ? 'Enabling…' : 'Enable'}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-ui-sm text-text-secondary hover:text-text-primary"
      >
        Not now
      </button>
    </div>
  );
};

export { PushPermissionPrompt };
