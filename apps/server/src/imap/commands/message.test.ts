import { describe, expect, test } from 'bun:test';

import type { ImapSession } from '../types.js';
import { createMessageCommandHandler } from './message.js';

interface TestMailbox {
  id: string;
  userId: string;
  name: string;
  uidValidity: number;
  uidNext: number;
  messageCount: number;
  unreadCount: number;
}

interface TestMessage {
  id: string;
  mailboxId: string;
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  fromAddress: string;
  toAddresses: string[];
  subjectEncrypted: Uint8Array | null;
  date: Date;
  flags: string[];
  size: number;
  dkimStatus: string | null;
  spfStatus: string | null;
  dmarcStatus: string | null;
}

interface TestBody {
  encryptedBody: Uint8Array;
  contentType: string;
}

function createStore() {
  const state = {
    mailboxes: [
      {
        id: 'mb-inbox',
        userId: 'user-1',
        name: 'INBOX',
        uidValidity: 123,
        uidNext: 4,
        messageCount: 3,
        unreadCount: 2,
      },
      {
        id: 'mb-archive',
        userId: 'user-1',
        name: 'Archive',
        uidValidity: 321,
        uidNext: 9,
        messageCount: 0,
        unreadCount: 0,
      },
    ] as TestMailbox[],
    messages: [
      {
        id: 'msg-1',
        mailboxId: 'mb-inbox',
        uid: 1,
        messageId: '<m1@example.com>',
        inReplyTo: null,
        fromAddress: 'alice@example.com',
        toAddresses: ['user@example.com'],
        subjectEncrypted: null,
        date: new Date('2024-01-01T12:00:00Z'),
        flags: ['seen'],
        size: 10,
        dkimStatus: 'pass',
        spfStatus: 'pass',
        dmarcStatus: 'pass',
      },
      {
        id: 'msg-2',
        mailboxId: 'mb-inbox',
        uid: 2,
        messageId: '<m2@example.com>',
        inReplyTo: null,
        fromAddress: 'bob@example.com',
        toAddresses: ['user@example.com', 'team@example.com'],
        subjectEncrypted: null,
        date: new Date('2024-01-02T12:00:00Z'),
        flags: ['flagged'],
        size: 24,
        dkimStatus: 'pass',
        spfStatus: 'pass',
        dmarcStatus: 'pass',
      },
      {
        id: 'msg-3',
        mailboxId: 'mb-inbox',
        uid: 3,
        messageId: '<m3@example.com>',
        inReplyTo: null,
        fromAddress: 'carol@example.com',
        toAddresses: ['user@example.com'],
        subjectEncrypted: null,
        date: new Date('2024-01-03T12:00:00Z'),
        flags: ['deleted'],
        size: 48,
        dkimStatus: 'pass',
        spfStatus: 'pass',
        dmarcStatus: 'pass',
      },
    ] as TestMessage[],
    bodies: {
      'msg-1': {
        encryptedBody: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        contentType: 'text/plain',
      },
      'msg-2': { encryptedBody: new Uint8Array([0xaa, 0xbb, 0xcc]), contentType: 'text/plain' },
      'msg-3': { encryptedBody: new Uint8Array([0x10, 0x20]), contentType: 'text/plain' },
    } as Record<string, TestBody>,
  };

  const store = {
    listMessages: async (mailboxId: string) => {
      return state.messages
        .filter((message) => message.mailboxId === mailboxId)
        .sort((left, right) => left.uid - right.uid)
        .map((message) => ({
          ...message,
          flags: [...message.flags],
          toAddresses: [...message.toAddresses],
        }));
    },
    getMessageBody: async (messageId: string) => {
      const body = state.bodies[messageId];
      if (!body) {
        return null;
      }
      return {
        encryptedBody: new Uint8Array(body.encryptedBody),
        contentType: body.contentType,
      };
    },
    updateFlags: async (entries: Array<{ messageId: string; flags: string[] }>) => {
      for (const entry of entries) {
        const message = state.messages.find((item) => item.id === entry.messageId);
        if (message) {
          message.flags = [...entry.flags];
        }
      }
    },
    findMailboxByName: async (userId: string, mailboxName: string) => {
      return (
        state.mailboxes.find(
          (mailbox) =>
            mailbox.userId === userId &&
            mailbox.name.toLowerCase() === mailboxName.trim().toLowerCase(),
        ) ?? null
      );
    },
    copyMessages: async (params: {
      destinationMailbox: TestMailbox;
      sourceMessages: TestMessage[];
    }) => {
      const destination = state.mailboxes.find(
        (entry) => entry.id === params.destinationMailbox.id,
      );
      if (!destination) {
        return [];
      }

      const destinationUids: number[] = [];
      let nextUid = destination.uidNext;
      for (const sourceMessage of params.sourceMessages) {
        const copiedId = `copied-${sourceMessage.id}-${nextUid}`;
        state.messages.push({
          ...sourceMessage,
          id: copiedId,
          mailboxId: destination.id,
          uid: nextUid,
          flags: [...sourceMessage.flags],
          toAddresses: [...sourceMessage.toAddresses],
        });

        const body = state.bodies[sourceMessage.id];
        if (body) {
          state.bodies[copiedId] = {
            encryptedBody: new Uint8Array(body.encryptedBody),
            contentType: body.contentType,
          };
        }

        destinationUids.push(nextUid);
        nextUid += 1;
      }

      destination.uidNext = nextUid;
      destination.messageCount += destinationUids.length;
      destination.unreadCount += params.sourceMessages.filter(
        (item) => !item.flags.includes('seen'),
      ).length;
      return destinationUids;
    },
    deleteMessagesByIds: async (messageIds: string[]) => {
      state.messages = state.messages.filter((message) => !messageIds.includes(message.id));
      for (const id of messageIds) {
        delete state.bodies[id];
      }
    },
    updateMailboxCounters: async (
      mailboxId: string,
      messageCount: number,
      unreadCount: number,
      uidNext?: number,
    ) => {
      const mailbox = state.mailboxes.find((item) => item.id === mailboxId);
      if (!mailbox) {
        return;
      }
      mailbox.messageCount = messageCount;
      mailbox.unreadCount = unreadCount;
      if (uidNext !== undefined) {
        mailbox.uidNext = uidNext;
      }
    },
    appendStubMessage: async (userId: string, mailboxName: string, literalSize: number) => {
      const mailbox = state.mailboxes.find(
        (item) => item.userId === userId && item.name.toLowerCase() === mailboxName.toLowerCase(),
      );
      if (!mailbox) {
        return false;
      }

      const id = `append-${mailbox.uidNext}`;
      state.messages.push({
        id,
        mailboxId: mailbox.id,
        uid: mailbox.uidNext,
        messageId: `<${id}@example.com>`,
        inReplyTo: null,
        fromAddress: 'unknown@localhost',
        toAddresses: [],
        subjectEncrypted: null,
        date: new Date('2024-01-05T12:00:00Z'),
        flags: [],
        size: literalSize,
        dkimStatus: null,
        spfStatus: null,
        dmarcStatus: null,
      });
      state.bodies[id] = {
        encryptedBody: new Uint8Array(),
        contentType: 'text/plain',
      };

      mailbox.uidNext += 1;
      mailbox.messageCount += 1;
      mailbox.unreadCount += 1;

      return true;
    },
  };

  return { store, state };
}

function selectedSession(): ImapSession {
  return {
    state: 'SELECTED',
    userId: 'user-1',
    selectedMailbox: 'mb-inbox',
  };
}

function decodeResponse(response: string | Uint8Array): string {
  return typeof response === 'string' ? response : new TextDecoder().decode(response);
}

describe('createMessageCommandHandler', () => {
  test('requires selected state for message commands', async () => {
    const { store } = createStore();
    const handler = createMessageCommandHandler(store);

    const result = await handler(
      { state: 'AUTHENTICATED', userId: 'user-1', selectedMailbox: null },
      { tag: 'A001', command: 'FETCH', args: ['1:*', '(FLAGS)'], raw: 'A001 FETCH 1:* (FLAGS)' },
    );

    expect(result.responses).toEqual(['A001 BAD Not in selected state\r\n']);
  });

  test('supports FETCH and UID FETCH including BODY[] literal bytes', async () => {
    const { store } = createStore();
    const handler = createMessageCommandHandler(store);

    const fetchResult = await handler(selectedSession(), {
      tag: 'A002',
      command: 'FETCH',
      args: ['1', '(FLAGS UID RFC822.SIZE INTERNALDATE)'],
      raw: 'A002 FETCH 1 (FLAGS UID RFC822.SIZE INTERNALDATE)',
    });

    expect(decodeResponse(fetchResult.responses[0] ?? '')).toContain(
      '* 1 FETCH (FLAGS (\\Seen) UID 1 RFC822.SIZE 10 INTERNALDATE "01-Jan-2024 12:00:00 +0000")\r\n',
    );
    expect(fetchResult.responses[1]).toBe('A002 OK FETCH completed\r\n');

    const uidFetchResult = await handler(selectedSession(), {
      tag: 'A003',
      command: 'UID',
      args: ['FETCH', '1', '(BODY[] UID)'],
      raw: 'A003 UID FETCH 1 (BODY[] UID)',
    });

    const literalResponse = uidFetchResult.responses[0];
    expect(literalResponse).toBeInstanceOf(Uint8Array);
    const literalBytes = literalResponse as Uint8Array;

    const prefix = new TextEncoder().encode('* 1 FETCH (BODY[] {4}\r\n');
    expect(Array.from(literalBytes.slice(0, prefix.length))).toEqual(Array.from(prefix));
    expect(Array.from(literalBytes.slice(prefix.length, prefix.length + 4))).toEqual([
      0xde, 0xad, 0xbe, 0xef,
    ]);
    expect(uidFetchResult.responses[1]).toBe('A003 OK UID FETCH completed\r\n');
  });

  test('supports STORE and UID STORE operations with silent variants', async () => {
    const { store, state } = createStore();
    const handler = createMessageCommandHandler(store);

    const addResult = await handler(selectedSession(), {
      tag: 'A004',
      command: 'STORE',
      args: ['2', '+FLAGS', '(\\Seen \\Flagged)'],
      raw: 'A004 STORE 2 +FLAGS (\\Seen \\Flagged)',
    });

    expect(addResult.responses[0]).toBe('* 2 FETCH (FLAGS (\\Seen \\Flagged))\r\n');
    expect(addResult.responses[1]).toBe('A004 OK STORE completed\r\n');
    expect(state.messages.find((item) => item.id === 'msg-2')?.flags).toEqual(['seen', 'flagged']);

    const removeSilentResult = await handler(selectedSession(), {
      tag: 'A005',
      command: 'UID',
      args: ['STORE', '3', '-FLAGS.SILENT', '(\\Deleted)'],
      raw: 'A005 UID STORE 3 -FLAGS.SILENT (\\Deleted)',
    });

    expect(removeSilentResult.responses).toEqual(['A005 OK UID STORE completed\r\n']);
    expect(state.messages.find((item) => item.id === 'msg-3')?.flags).toEqual([]);
  });

  test('supports SEARCH and UID SEARCH criteria', async () => {
    const { store } = createStore();
    const handler = createMessageCommandHandler(store);

    const searchResult = await handler(selectedSession(), {
      tag: 'A006',
      command: 'SEARCH',
      args: ['UNSEEN', 'FROM', 'bob', 'LARGER', '20'],
      raw: 'A006 SEARCH UNSEEN FROM "bob" LARGER 20',
    });

    expect(searchResult.responses).toEqual(['* SEARCH 2\r\n', 'A006 OK SEARCH completed\r\n']);

    const uidSearchResult = await handler(selectedSession(), {
      tag: 'A007',
      command: 'UID',
      args: ['SEARCH', 'UNSEEN', 'UID', '2:3'],
      raw: 'A007 UID SEARCH UNSEEN UID 2:3',
    });

    expect(uidSearchResult.responses).toEqual([
      '* SEARCH 2 3\r\n',
      'A007 OK UID SEARCH completed\r\n',
    ]);
  });

  test('supports COPY and UID COPY with COPYUID response', async () => {
    const { store } = createStore();
    const handler = createMessageCommandHandler(store);

    const copyResult = await handler(selectedSession(), {
      tag: 'A008',
      command: 'COPY',
      args: ['1:2', 'Archive'],
      raw: 'A008 COPY 1:2 Archive',
    });

    expect(copyResult.responses).toEqual(['A008 OK [COPYUID 321 1,2 9,10] COPY completed\r\n']);

    const uidCopyResult = await handler(selectedSession(), {
      tag: 'A009',
      command: 'UID',
      args: ['COPY', '3', 'Archive'],
      raw: 'A009 UID COPY 3 Archive',
    });

    expect(uidCopyResult.responses).toEqual(['A009 OK [COPYUID 321 3 11] COPY completed\r\n']);
  });

  test('expunges deleted messages in reverse sequence order', async () => {
    const { store, state } = createStore();
    const handler = createMessageCommandHandler(store);

    const result = await handler(selectedSession(), {
      tag: 'A010',
      command: 'EXPUNGE',
      args: [],
      raw: 'A010 EXPUNGE',
    });

    expect(result.responses).toEqual(['* 3 EXPUNGE\r\n', 'A010 OK EXPUNGE completed\r\n']);
    expect(state.messages.some((message) => message.id === 'msg-3')).toBe(false);
    const inbox = state.mailboxes.find((mailbox) => mailbox.id === 'mb-inbox');
    expect(inbox?.messageCount).toBe(2);
    expect(inbox?.unreadCount).toBe(1);
  });

  test('supports APPEND stub outside selected state', async () => {
    const { store, state } = createStore();
    const handler = createMessageCommandHandler(store);

    const result = await handler(
      { state: 'AUTHENTICATED', userId: 'user-1', selectedMailbox: null },
      {
        tag: 'A011',
        command: 'APPEND',
        args: ['Archive', '(\\Seen)', '{12}'],
        raw: 'A011 APPEND Archive (\\Seen) {12}',
      },
    );

    expect(result.responses).toEqual(['A011 OK APPEND completed\r\n']);
    const archiveMailbox = state.mailboxes.find((mailbox) => mailbox.id === 'mb-archive');
    expect(archiveMailbox?.messageCount).toBe(1);
  });
});
