import webPush from 'web-push';

import { db, pushSubscriptions } from '@enclave/db';
import { eq } from 'drizzle-orm';

export type VapidKeys = {
  publicKey: string;
  privateKey: string;
};

export type PushSubscriptionData = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

let configured = false;

function ensureVapidConfigured(): VapidKeys {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    console.warn(
      '[push] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY not set. ' +
        'Generate with: npx web-push generate-vapid-keys',
    );
    throw new Error('VAPID keys not configured');
  }

  if (!configured) {
    const mailto = process.env.VAPID_MAILTO ?? 'mailto:admin@localhost';
    webPush.setVapidDetails(mailto, publicKey, privateKey);
    configured = true;
  }

  return { publicKey, privateKey };
}

export function getVapidPublicKey(): string {
  return ensureVapidConfigured().publicKey;
}

export async function sendPushNotification(
  subscription: PushSubscriptionData,
  payload: string,
): Promise<void> {
  ensureVapidConfigured();

  await webPush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    },
    payload,
  );
}

export async function dispatchPushToUser(
  userId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const subs = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  if (subs.length === 0) return;

  const payloadStr = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subs.map((sub) =>
      sendPushNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payloadStr,
      ),
    ),
  );

  // Clean up stale subscriptions (410 Gone)
  for (let i = 0; i < results.length; i++) {
    const result = results[i] as PromiseSettledResult<void>;
    if (result.status === 'rejected') {
      const err = result.reason as { statusCode?: number };
      if (err.statusCode === 410 || err.statusCode === 404) {
        const sub = subs[i];
        if (sub) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, sub.endpoint))
            .catch(() => {});
        }
      }
    }
  }
}
