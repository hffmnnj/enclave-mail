import { describe, expect, test } from 'bun:test';

import type { ImapSession } from '../types.js';
import { createMailboxCommandHandler } from './mailbox.js';

type MailboxType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive' | 'custom';

interface TestMailbox {
  id: string;
  userId: string;
  name: string;
  type: MailboxType;
  uidValidity: number;
  uidNext: number;
  messageCount: number;
  unreadCount: number;
}

interface TestMessage {
  id: string;
  mailboxId: string;
  uid: number;
  flags: string[];
}

function createStore() {
  const state = {
    mailboxes: [
      {
        id: 'mb-inbox',
        userId: 'user-1',
        name: 'INBOX',
        type: 'inbox',
        uidValidity: 123,
        uidNext: 4,
        messageCount: 3,
        unreadCount: 1,
      },
      {
        id: 'mb-sent',
        userId: 'user-1',
        name: 'Sent',
        type: 'sent',
        uidValidity: 123,
        uidNext: 1,
        messageCount: 0,
        unreadCount: 0,
      },
      {
        id: 'mb-projects',
        userId: 'user-1',
        name: 'Projects',
        type: 'custom',
        uidValidity: 777,
        uidNext: 2,
        messageCount: 1,
        unreadCount: 1,
      },
    ] as TestMailbox[],
    messages: [
      { id: 'msg-1', mailboxId: 'mb-inbox', uid: 1, flags: ['seen'] },
      { id: 'msg-2', mailboxId: 'mb-inbox', uid: 2, flags: [] },
      { id: 'msg-3', mailboxId: 'mb-inbox', uid: 3, flags: ['deleted'] },
      { id: 'msg-4', mailboxId: 'mb-projects', uid: 1, flags: [] },
    ] as TestMessage[],
  };

  const store = {
    listMailboxes: async (userId: string) => {
      return state.mailboxes.filter((mailbox) => mailbox.userId === userId);
    },
    findMailboxByName: async (userId: string, mailboxName: string) => {
      const normalized = mailboxName.trim().toLowerCase();
      const systemTypeByName: Record<string, MailboxType> = {
        inbox: 'inbox',
        sent: 'sent',
        drafts: 'drafts',
        trash: 'trash',
        archive: 'archive',
      };

      const systemType = systemTypeByName[normalized];
      if (systemType) {
        return (
          state.mailboxes.find(
            (mailbox) => mailbox.userId === userId && mailbox.type === systemType,
          ) ?? null
        );
      }

      return (
        state.mailboxes.find(
          (mailbox) => mailbox.userId === userId && mailbox.name === mailboxName,
        ) ?? null
      );
    },
    findMailboxByNameCaseInsensitive: async (userId: string, mailboxName: string) => {
      const normalized = mailboxName.trim().toLowerCase();
      return (
        state.mailboxes.find(
          (mailbox) => mailbox.userId === userId && mailbox.name.toLowerCase() === normalized,
        ) ?? null
      );
    },
    createMailbox: async (userId: string, name: string, uidValidity: number) => {
      const mailbox: TestMailbox = {
        id: `mb-${name.toLowerCase()}`,
        userId,
        name,
        type: 'custom',
        uidValidity,
        uidNext: 1,
        messageCount: 0,
        unreadCount: 0,
      };
      state.mailboxes.push(mailbox);
      return mailbox;
    },
    deleteMailboxById: async (userId: string, mailboxId: string) => {
      const index = state.mailboxes.findIndex(
        (mailbox) => mailbox.userId === userId && mailbox.id === mailboxId,
      );
      if (index === -1) {
        return false;
      }

      state.mailboxes.splice(index, 1);
      state.messages = state.messages.filter((message) => message.mailboxId !== mailboxId);
      return true;
    },
    listMessageMeta: async (mailboxId: string) => {
      return state.messages
        .filter((message) => message.mailboxId === mailboxId)
        .map((message) => ({ uid: message.uid, flags: [...message.flags] }))
        .sort((left, right) => left.uid - right.uid);
    },
    expungeDeletedMessages: async (mailboxId: string) => {
      const before = state.messages.length;
      state.messages = state.messages.filter(
        (message) => message.mailboxId !== mailboxId || !message.flags.includes('deleted'),
      );
      return before - state.messages.length;
    },
    updateMailboxCounters: async (mailboxId: string, messageCount: number, unreadCount: number) => {
      const mailbox = state.mailboxes.find((entry) => entry.id === mailboxId);
      if (!mailbox) {
        return;
      }

      mailbox.messageCount = messageCount;
      mailbox.unreadCount = unreadCount;
    },
  };

  return { store, state };
}

function authenticatedSession(): ImapSession {
  return {
    state: 'AUTHENTICATED',
    userId: 'user-1',
    selectedMailbox: null,
  };
}

describe('createMailboxCommandHandler', () => {
  test('rejects mailbox commands when not authenticated', async () => {
    const { store } = createStore();
    const handler = createMailboxCommandHandler(store);

    const result = await handler(
      { state: 'NOT_AUTHENTICATED', userId: null, selectedMailbox: null },
      { tag: 'A001', command: 'LIST', args: ['', '*'], raw: 'A001 LIST "" "*"' },
    );

    expect(result.responses).toEqual(['A001 BAD Not authenticated\r\n']);
  });

  test('returns LIST and LSUB output with IMAP special-use flags', async () => {
    const { store } = createStore();
    const handler = createMailboxCommandHandler(store);
    const session = authenticatedSession();

    const listResult = await handler(session, {
      tag: 'A002',
      command: 'LIST',
      args: ['', '*'],
      raw: 'A002 LIST "" "*"',
    });

    expect(listResult.responses).toContain('* LIST (\\Inbox) "/" "INBOX"\r\n');
    expect(listResult.responses).toContain('* LIST (\\Sent) "/" "Sent"\r\n');
    expect(listResult.responses).toContain('* LIST () "/" "Projects"\r\n');
    expect(listResult.responses[listResult.responses.length - 1]).toBe(
      'A002 OK LIST completed\r\n',
    );

    const lsubResult = await handler(session, {
      tag: 'A003',
      command: 'LSUB',
      args: ['', 'INBOX'],
      raw: 'A003 LSUB "" "INBOX"',
    });

    expect(lsubResult.responses).toEqual([
      '* LSUB (\\Inbox) "/" "INBOX"\r\n',
      'A003 OK LSUB completed\r\n',
    ]);
  });

  test('handles SELECT and EXAMINE with state transition', async () => {
    const { store } = createStore();
    const handler = createMailboxCommandHandler(store);

    const selectSession = authenticatedSession();
    const selectResult = await handler(selectSession, {
      tag: 'A004',
      command: 'SELECT',
      args: ['INBOX'],
      raw: 'A004 SELECT INBOX',
    });

    expect(selectSession.state).toBe('SELECTED');
    expect(selectSession.selectedMailbox).toBe('mb-inbox');
    expect(selectResult.responses).toEqual([
      '* 3 EXISTS\r\n',
      '* 0 RECENT\r\n',
      '* OK [UNSEEN 2] First unseen message\r\n',
      '* OK [UIDVALIDITY 123]\r\n',
      '* OK [UIDNEXT 4]\r\n',
      '* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n',
      '* OK [PERMANENTFLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft \\*)]\r\n',
      'A004 OK [READ-WRITE] SELECT completed\r\n',
    ]);

    const examineSession = authenticatedSession();
    const examineResult = await handler(examineSession, {
      tag: 'A005',
      command: 'EXAMINE',
      args: ['INBOX'],
      raw: 'A005 EXAMINE INBOX',
    });

    expect(examineResult.responses[examineResult.responses.length - 1]).toBe(
      'A005 OK [READ-ONLY] EXAMINE completed\r\n',
    );
  });

  test('supports CREATE and DELETE with system mailbox protections', async () => {
    const { store, state } = createStore();
    const handler = createMailboxCommandHandler(store);
    const session = authenticatedSession();

    const createReserved = await handler(session, {
      tag: 'A006',
      command: 'CREATE',
      args: ['INBOX'],
      raw: 'A006 CREATE INBOX',
    });
    expect(createReserved.responses).toEqual([
      'A006 NO CREATE failed (system mailbox name reserved)\r\n',
    ]);

    const createCustom = await handler(session, {
      tag: 'A007',
      command: 'CREATE',
      args: ['Reports'],
      raw: 'A007 CREATE Reports',
    });
    expect(createCustom.responses).toEqual(['A007 OK CREATE completed\r\n']);
    expect(state.mailboxes.some((mailbox) => mailbox.name === 'Reports')).toBe(true);

    const deleteSystem = await handler(session, {
      tag: 'A008',
      command: 'DELETE',
      args: ['INBOX'],
      raw: 'A008 DELETE INBOX',
    });
    expect(deleteSystem.responses).toEqual(['A008 NO DELETE failed (system mailbox)\r\n']);

    const deleteCustom = await handler(session, {
      tag: 'A009',
      command: 'DELETE',
      args: ['Reports'],
      raw: 'A009 DELETE Reports',
    });
    expect(deleteCustom.responses).toEqual(['A009 OK DELETE completed\r\n']);
  });

  test('returns STATUS values and handles CLOSE expunge', async () => {
    const { store, state } = createStore();
    const handler = createMailboxCommandHandler(store);

    const statusResult = await handler(authenticatedSession(), {
      tag: 'A010',
      command: 'STATUS',
      args: ['INBOX', '(MESSAGES', 'UNSEEN', 'UIDNEXT', 'UIDVALIDITY)'],
      raw: 'A010 STATUS INBOX (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)',
    });

    expect(statusResult.responses).toEqual([
      '* STATUS "INBOX" (MESSAGES 3 UNSEEN 2 UIDNEXT 4 UIDVALIDITY 123)\r\n',
      'A010 OK STATUS completed\r\n',
    ]);

    const selectedSession: ImapSession = {
      state: 'SELECTED',
      userId: 'user-1',
      selectedMailbox: 'mb-inbox',
    };
    const closeResult = await handler(selectedSession, {
      tag: 'A011',
      command: 'CLOSE',
      args: [],
      raw: 'A011 CLOSE',
    });

    expect(closeResult.responses).toEqual(['A011 OK CLOSE completed\r\n']);
    expect(selectedSession.state).toBe('AUTHENTICATED');
    expect(selectedSession.selectedMailbox).toBeNull();

    const inboxMessages = state.messages.filter((message) => message.mailboxId === 'mb-inbox');
    expect(inboxMessages).toHaveLength(2);
    expect(inboxMessages.some((message) => message.flags.includes('deleted'))).toBe(false);
  });
});
