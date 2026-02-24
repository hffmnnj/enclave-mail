import { describe, expect, test } from 'bun:test';

import { createImapSessionProcessor } from '../server.js';

describe('IMAP IDLE command', () => {
  test('enters idle mode in SELECTED state', async () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
      subscribeUpdates: () => () => undefined,
    });

    processor.session.state = 'SELECTED';
    processor.session.userId = 'user-1';
    processor.session.selectedMailbox = 'mailbox-1';

    const result = await processor.onLine('A001 IDLE');

    expect(result.responses).toEqual(['+ idling\r\n']);
    expect(processor.session.isIdling).toBe(true);
    expect(processor.session.idleTag).toBe('A001');
  });

  test('rejects IDLE when mailbox is not selected', async () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
      subscribeUpdates: () => () => undefined,
    });

    const result = await processor.onLine('A002 IDLE');

    expect(result.responses).toEqual(['A002 BAD Not in selected state\r\n']);
    expect(processor.session.isIdling).toBe(false);
  });

  test('DONE exits idle mode and returns tagged completion', async () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
      subscribeUpdates: () => () => undefined,
    });

    processor.session.state = 'SELECTED';
    processor.session.userId = 'user-1';
    processor.session.selectedMailbox = 'mailbox-1';

    await processor.onLine('A003 IDLE');
    const done = await processor.onLine('DONE');

    expect(done.responses).toEqual(['A003 OK IDLE terminated\r\n']);
    expect(processor.session.isIdling).toBe(false);
  });

  test('pushes EXISTS updates while idling', async () => {
    const pushed: string[] = [];
    let listener: ((count: number) => void) | null = null;

    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
      pushResponse: (response) => {
        pushed.push(response);
      },
      subscribeUpdates: (_mailboxId, callback) => {
        listener = callback;
        return () => {
          listener = null;
        };
      },
    });

    processor.session.state = 'SELECTED';
    processor.session.userId = 'user-1';
    processor.session.selectedMailbox = 'mailbox-1';

    await processor.onLine('A004 IDLE');
    if (listener) {
      (listener as (count: number) => void)(3);
    }

    expect(pushed).toEqual(['* 3 EXISTS\r\n']);
  });

  test('times out idle sessions after configured duration', async () => {
    const pushed: string[] = [];
    let closed = false;
    let timerCallback: (() => void) | null = null;

    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
      pushResponse: (response) => {
        pushed.push(response);
      },
      closeConnection: () => {
        closed = true;
      },
      subscribeUpdates: () => () => undefined,
      setTimer: (callback) => {
        timerCallback = callback;
        return setTimeout(() => undefined, 0);
      },
      clearTimer: (handle) => {
        clearTimeout(handle);
      },
    });

    processor.session.state = 'SELECTED';
    processor.session.userId = 'user-1';
    processor.session.selectedMailbox = 'mailbox-1';

    await processor.onLine('A005 IDLE');
    if (timerCallback) {
      (timerCallback as () => void)();
    }

    expect(pushed).toContain('* BYE IDLE timeout\r\n');
    expect(closed).toBe(true);
    expect(processor.session.isIdling).toBe(false);
  });
});
