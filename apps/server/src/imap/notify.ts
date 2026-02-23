import { EventEmitter } from 'node:events';

import Redis from 'ioredis';

type MailboxUpdateType = 'new_message' | 'flags_changed';

type MailboxUpdateEvent = {
  mailboxId: string;
  type: MailboxUpdateType;
  messageCount: number;
};

type MailboxUpdateCallback = (count: number) => void;

const emitter = new EventEmitter();
const redisSubscriptions = new Map<string, Set<MailboxUpdateCallback>>();

let redisPublisher: Redis | null = null;
let redisSubscriber: Redis | null = null;
let redisMessageHandlerAttached = false;

function mailboxEventKey(mailboxId: string): string {
  return `mailbox:${mailboxId}`;
}

function mailboxChannel(mailboxId: string): string {
  return `imap:mailbox:${mailboxId}`;
}

function createPubSubConnection(): Redis {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

function isRedisPubSubEnabled(): boolean {
  return process.env.REDIS_PUBSUB === 'true';
}

function isMailboxUpdateEvent(payload: unknown): payload is MailboxUpdateEvent {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Partial<MailboxUpdateEvent>;
  return (
    typeof candidate.mailboxId === 'string' &&
    (candidate.type === 'new_message' || candidate.type === 'flags_changed') &&
    typeof candidate.messageCount === 'number' &&
    Number.isFinite(candidate.messageCount) &&
    candidate.messageCount >= 0
  );
}

function getRedisPublisher(): Redis {
  if (!redisPublisher) {
    redisPublisher = createPubSubConnection();
    redisPublisher.on('error', () => undefined);
  }

  return redisPublisher;
}

function getRedisSubscriber(): Redis {
  if (!redisSubscriber) {
    redisSubscriber = createPubSubConnection();
    redisSubscriber.on('error', () => undefined);
  }

  if (!redisMessageHandlerAttached) {
    redisMessageHandlerAttached = true;
    redisSubscriber.on('message', (channel: string, payloadRaw: string) => {
      if (!channel.startsWith('imap:mailbox:')) {
        return;
      }

      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(payloadRaw);
      } catch {
        return;
      }

      if (!isMailboxUpdateEvent(parsedPayload) || parsedPayload.type !== 'new_message') {
        return;
      }

      const callbacks = redisSubscriptions.get(channel);
      if (!callbacks || callbacks.size === 0) {
        return;
      }

      for (const callback of callbacks) {
        callback(parsedPayload.messageCount);
      }
    });
  }

  return redisSubscriber;
}

export function publishMailboxUpdate(mailboxId: string, messageCount: number): void {
  if (!isRedisPubSubEnabled()) {
    emitter.emit(mailboxEventKey(mailboxId), messageCount);
    return;
  }

  const event: MailboxUpdateEvent = {
    mailboxId,
    type: 'new_message',
    messageCount,
  };

  const publisher = getRedisPublisher();
  void publisher.publish(mailboxChannel(mailboxId), JSON.stringify(event));
}

export function subscribeMailboxUpdates(
  mailboxId: string,
  callback: MailboxUpdateCallback,
): () => void {
  if (!isRedisPubSubEnabled()) {
    const eventKey = mailboxEventKey(mailboxId);
    emitter.on(eventKey, callback);
    return () => {
      emitter.off(eventKey, callback);
    };
  }

  const channel = mailboxChannel(mailboxId);
  const callbacks = redisSubscriptions.get(channel) ?? new Set<MailboxUpdateCallback>();
  const isFirstSubscriber = callbacks.size === 0;
  callbacks.add(callback);
  redisSubscriptions.set(channel, callbacks);

  const subscriber = getRedisSubscriber();
  if (isFirstSubscriber) {
    void subscriber.subscribe(channel);
  }

  return () => {
    const active = redisSubscriptions.get(channel);
    if (!active) {
      return;
    }

    active.delete(callback);
    if (active.size > 0) {
      return;
    }

    redisSubscriptions.delete(channel);
    void subscriber.unsubscribe(channel);
  };
}
