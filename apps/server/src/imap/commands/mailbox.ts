import { db, mailboxes, messages } from '@enclave/db';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { ImapCommand, ImapCommandResult, ImapSession } from '../types.js';

export const MAILBOX_COMMANDS = new Set([
  'LIST',
  'LSUB',
  'SELECT',
  'EXAMINE',
  'CREATE',
  'DELETE',
  'STATUS',
  'CLOSE',
] as const);

type MailboxCommandName =
  | 'LIST'
  | 'LSUB'
  | 'SELECT'
  | 'EXAMINE'
  | 'CREATE'
  | 'DELETE'
  | 'STATUS'
  | 'CLOSE';

type MailboxType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive' | 'custom';

interface MailboxRow {
  id: string;
  userId: string;
  name: string;
  type: MailboxType;
  uidValidity: number;
  uidNext: number;
  messageCount: number;
  unreadCount: number;
}

interface MessageMeta {
  uid: number;
  flags: string[];
}

interface MailboxStore {
  listMailboxes: (userId: string) => Promise<MailboxRow[]>;
  findMailboxByName: (userId: string, mailboxName: string) => Promise<MailboxRow | null>;
  findMailboxByNameCaseInsensitive: (
    userId: string,
    mailboxName: string,
  ) => Promise<MailboxRow | null>;
  createMailbox: (userId: string, name: string, uidValidity: number) => Promise<MailboxRow | null>;
  deleteMailboxById: (userId: string, mailboxId: string) => Promise<boolean>;
  listMessageMeta: (mailboxId: string) => Promise<MessageMeta[]>;
  expungeDeletedMessages: (mailboxId: string) => Promise<number>;
  updateMailboxCounters: (
    mailboxId: string,
    messageCount: number,
    unreadCount: number,
  ) => Promise<void>;
}

const SYSTEM_MAILBOXES: Record<string, MailboxType> = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  trash: 'trash',
  archive: 'archive',
};

const SYSTEM_MAILBOX_NAMES = new Set(['inbox', 'sent', 'drafts', 'trash', 'archive', 'junk']);

const SPECIAL_USE_FLAGS: Record<MailboxType, string> = {
  inbox: '\\Inbox',
  sent: '\\Sent',
  drafts: '\\Drafts',
  trash: '\\Trash',
  archive: '\\Archive',
  custom: '',
};

const SELECTABLE_STATES = new Set<ImapSession['state']>(['AUTHENTICATED', 'SELECTED']);

function toUntagged(response: string): string {
  return `* ${response}\r\n`;
}

function toTagged(tag: string, status: 'OK' | 'NO' | 'BAD', message: string): string {
  return `${tag} ${status} ${message}\r\n`;
}

function escapeImapString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function mailboxFlags(mailboxType: MailboxType): string {
  const specialUse = SPECIAL_USE_FLAGS[mailboxType];
  return specialUse ? `(${specialUse})` : '()';
}

function normalizeMailboxName(value: string): string {
  return value.trim();
}

function asSystemMailboxType(mailboxName: string): MailboxType | null {
  const normalized = mailboxName.trim().toLowerCase();
  return SYSTEM_MAILBOXES[normalized] ?? null;
}

function isAuthenticatedForMailboxCommands(
  session: ImapSession,
): session is ImapSession & { userId: string } {
  return SELECTABLE_STATES.has(session.state) && typeof session.userId === 'string';
}

function toMailboxStats(messageMeta: MessageMeta[]): {
  exists: number;
  unseenCount: number;
  firstUnseen: number;
} {
  const unseenUids: number[] = [];
  for (const message of messageMeta) {
    if (!message.flags.includes('seen')) {
      unseenUids.push(message.uid);
    }
  }

  return {
    exists: messageMeta.length,
    unseenCount: unseenUids.length,
    firstUnseen: unseenUids[0] ?? 0,
  };
}

function matchesMailboxPattern(mailboxName: string, pattern: string): boolean {
  if (!pattern || pattern === '*') {
    return true;
  }

  const escaped = pattern.replaceAll(/[.+^${}()|[\]\\]/g, '\\$&');
  const wildcardPattern = escaped.replaceAll('%', '[^/]*').replaceAll('*', '.*');
  const regex = new RegExp(`^${wildcardPattern}$`, 'i');

  return regex.test(mailboxName);
}

function parseStatusItems(args: string[]): string[] | null {
  const raw = args.join(' ').trim();
  if (!raw.startsWith('(') || !raw.endsWith(')')) {
    return null;
  }

  const values = raw
    .slice(1, -1)
    .trim()
    .split(/\s+/)
    .map((item) => item.toUpperCase())
    .filter((item) => item.length > 0);

  if (values.length === 0) {
    return null;
  }

  return values;
}

function createDrizzleMailboxStore(): MailboxStore {
  return {
    listMailboxes: async (userId) => {
      return db
        .select({
          id: mailboxes.id,
          userId: mailboxes.userId,
          name: mailboxes.name,
          type: mailboxes.type,
          uidValidity: mailboxes.uidValidity,
          uidNext: mailboxes.uidNext,
          messageCount: mailboxes.messageCount,
          unreadCount: mailboxes.unreadCount,
        })
        .from(mailboxes)
        .where(eq(mailboxes.userId, userId))
        .orderBy(asc(mailboxes.name));
    },
    findMailboxByName: async (userId, mailboxName) => {
      const systemType = asSystemMailboxType(mailboxName);
      const rows =
        systemType !== null
          ? await db
              .select({
                id: mailboxes.id,
                userId: mailboxes.userId,
                name: mailboxes.name,
                type: mailboxes.type,
                uidValidity: mailboxes.uidValidity,
                uidNext: mailboxes.uidNext,
                messageCount: mailboxes.messageCount,
                unreadCount: mailboxes.unreadCount,
              })
              .from(mailboxes)
              .where(and(eq(mailboxes.userId, userId), eq(mailboxes.type, systemType)))
              .limit(1)
          : await db
              .select({
                id: mailboxes.id,
                userId: mailboxes.userId,
                name: mailboxes.name,
                type: mailboxes.type,
                uidValidity: mailboxes.uidValidity,
                uidNext: mailboxes.uidNext,
                messageCount: mailboxes.messageCount,
                unreadCount: mailboxes.unreadCount,
              })
              .from(mailboxes)
              .where(and(eq(mailboxes.userId, userId), eq(mailboxes.name, mailboxName)))
              .limit(1);

      return rows[0] ?? null;
    },
    findMailboxByNameCaseInsensitive: async (userId, mailboxName) => {
      const rows = await db
        .select({
          id: mailboxes.id,
          userId: mailboxes.userId,
          name: mailboxes.name,
          type: mailboxes.type,
          uidValidity: mailboxes.uidValidity,
          uidNext: mailboxes.uidNext,
          messageCount: mailboxes.messageCount,
          unreadCount: mailboxes.unreadCount,
        })
        .from(mailboxes)
        .where(
          and(
            eq(mailboxes.userId, userId),
            sql`lower(${mailboxes.name}) = ${mailboxName.trim().toLowerCase()}`,
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    },
    createMailbox: async (userId, name, uidValidity) => {
      const inserted = await db
        .insert(mailboxes)
        .values({
          userId,
          name,
          type: 'custom',
          uidValidity,
          uidNext: 1,
          messageCount: 0,
          unreadCount: 0,
        })
        .returning({
          id: mailboxes.id,
          userId: mailboxes.userId,
          name: mailboxes.name,
          type: mailboxes.type,
          uidValidity: mailboxes.uidValidity,
          uidNext: mailboxes.uidNext,
          messageCount: mailboxes.messageCount,
          unreadCount: mailboxes.unreadCount,
        });

      return inserted[0] ?? null;
    },
    deleteMailboxById: async (userId, mailboxId) => {
      const deleted = await db
        .delete(mailboxes)
        .where(and(eq(mailboxes.userId, userId), eq(mailboxes.id, mailboxId)))
        .returning({ id: mailboxes.id });

      return deleted.length > 0;
    },
    listMessageMeta: async (mailboxId) => {
      return db
        .select({
          uid: messages.uid,
          flags: messages.flags,
        })
        .from(messages)
        .where(eq(messages.mailboxId, mailboxId))
        .orderBy(asc(messages.uid));
    },
    expungeDeletedMessages: async (mailboxId) => {
      const deleted = await db
        .delete(messages)
        .where(
          and(eq(messages.mailboxId, mailboxId), sql`${messages.flags} @> '["deleted"]'::jsonb`),
        )
        .returning({ id: messages.id });

      return deleted.length;
    },
    updateMailboxCounters: async (mailboxId, messageCount, unreadCount) => {
      await db
        .update(mailboxes)
        .set({
          messageCount,
          unreadCount,
        })
        .where(eq(mailboxes.id, mailboxId));
    },
  };
}

export type MailboxCommandHandler = (
  session: ImapSession,
  command: ImapCommand,
) => Promise<ImapCommandResult>;

export function createMailboxCommandHandler(
  store: MailboxStore = createDrizzleMailboxStore(),
): MailboxCommandHandler {
  return async (session, command) => {
    const responses: string[] = [];

    if (!isAuthenticatedForMailboxCommands(session)) {
      responses.push(toTagged(command.tag, 'BAD', 'Not authenticated'));
      return { responses, closeConnection: false };
    }

    const userId = session.userId;
    const commandName = command.command as MailboxCommandName;

    switch (commandName) {
      case 'LIST':
      case 'LSUB': {
        if (command.args.length < 2) {
          responses.push(
            toTagged(command.tag, 'BAD', `${commandName} requires reference and mailbox pattern`),
          );
          return { responses, closeConnection: false };
        }

        const pattern = command.args[1] ?? '*';
        const userMailboxes = await store.listMailboxes(userId);

        for (const mailbox of userMailboxes) {
          if (!matchesMailboxPattern(mailbox.name, pattern)) {
            continue;
          }

          responses.push(
            toUntagged(
              `${commandName} ${mailboxFlags(mailbox.type)} "/" "${escapeImapString(mailbox.name)}"`,
            ),
          );
        }

        responses.push(toTagged(command.tag, 'OK', `${commandName} completed`));
        return { responses, closeConnection: false };
      }

      case 'SELECT':
      case 'EXAMINE': {
        const mailboxName = command.args[0];
        if (!mailboxName) {
          responses.push(toTagged(command.tag, 'BAD', `${commandName} requires mailbox name`));
          return { responses, closeConnection: false };
        }

        const mailbox = await store.findMailboxByName(userId, normalizeMailboxName(mailboxName));
        if (!mailbox) {
          responses.push(toTagged(command.tag, 'NO', `${commandName} failed`));
          return { responses, closeConnection: false };
        }

        const messageMeta = await store.listMessageMeta(mailbox.id);
        const stats = toMailboxStats(messageMeta);

        session.state = 'SELECTED';
        session.selectedMailbox = mailbox.id;

        responses.push(toUntagged(`${stats.exists} EXISTS`));
        responses.push(toUntagged('0 RECENT'));
        responses.push(toUntagged(`OK [UNSEEN ${stats.firstUnseen}] First unseen message`));
        responses.push(toUntagged(`OK [UIDVALIDITY ${mailbox.uidValidity}]`));
        responses.push(toUntagged(`OK [UIDNEXT ${mailbox.uidNext}]`));
        responses.push(toUntagged('FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)'));
        responses.push(
          toUntagged('OK [PERMANENTFLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft \\*)]'),
        );

        const mode = commandName === 'EXAMINE' ? 'READ-ONLY' : 'READ-WRITE';
        responses.push(toTagged(command.tag, 'OK', `[${mode}] ${commandName} completed`));
        return { responses, closeConnection: false };
      }

      case 'CREATE': {
        const mailboxName = command.args[0];
        if (!mailboxName) {
          responses.push(toTagged(command.tag, 'BAD', 'CREATE requires mailbox name'));
          return { responses, closeConnection: false };
        }

        const normalizedName = normalizeMailboxName(mailboxName);
        if (!normalizedName) {
          responses.push(toTagged(command.tag, 'BAD', 'CREATE requires mailbox name'));
          return { responses, closeConnection: false };
        }

        if (SYSTEM_MAILBOX_NAMES.has(normalizedName.toLowerCase())) {
          responses.push(
            toTagged(command.tag, 'NO', 'CREATE failed (system mailbox name reserved)'),
          );
          return { responses, closeConnection: false };
        }

        const existing = await store.findMailboxByNameCaseInsensitive(userId, normalizedName);
        if (existing) {
          responses.push(toTagged(command.tag, 'NO', 'CREATE failed (mailbox exists)'));
          return { responses, closeConnection: false };
        }

        const created = await store.createMailbox(
          userId,
          normalizedName,
          Math.floor(Date.now() / 1000),
        );
        if (!created) {
          responses.push(toTagged(command.tag, 'NO', 'CREATE failed'));
          return { responses, closeConnection: false };
        }

        responses.push(toTagged(command.tag, 'OK', 'CREATE completed'));
        return { responses, closeConnection: false };
      }

      case 'DELETE': {
        const mailboxName = command.args[0];
        if (!mailboxName) {
          responses.push(toTagged(command.tag, 'BAD', 'DELETE requires mailbox name'));
          return { responses, closeConnection: false };
        }

        const mailbox = await store.findMailboxByName(userId, normalizeMailboxName(mailboxName));
        if (!mailbox) {
          responses.push(toTagged(command.tag, 'NO', 'DELETE failed'));
          return { responses, closeConnection: false };
        }

        if (mailbox.type !== 'custom') {
          responses.push(toTagged(command.tag, 'NO', 'DELETE failed (system mailbox)'));
          return { responses, closeConnection: false };
        }

        const deleted = await store.deleteMailboxById(userId, mailbox.id);
        if (!deleted) {
          responses.push(toTagged(command.tag, 'NO', 'DELETE failed'));
          return { responses, closeConnection: false };
        }

        responses.push(toTagged(command.tag, 'OK', 'DELETE completed'));
        return { responses, closeConnection: false };
      }

      case 'STATUS': {
        const mailboxName = command.args[0];
        if (!mailboxName) {
          responses.push(toTagged(command.tag, 'BAD', 'STATUS requires mailbox name'));
          return { responses, closeConnection: false };
        }

        const items = parseStatusItems(command.args.slice(1));
        if (!items) {
          responses.push(toTagged(command.tag, 'BAD', 'STATUS requires data items list'));
          return { responses, closeConnection: false };
        }

        const mailbox = await store.findMailboxByName(userId, normalizeMailboxName(mailboxName));
        if (!mailbox) {
          responses.push(toTagged(command.tag, 'NO', 'STATUS failed'));
          return { responses, closeConnection: false };
        }

        const messageMeta = await store.listMessageMeta(mailbox.id);
        const stats = toMailboxStats(messageMeta);

        const itemValues: string[] = [];
        for (const item of items) {
          switch (item) {
            case 'MESSAGES':
              itemValues.push('MESSAGES', String(stats.exists));
              break;
            case 'UNSEEN':
              itemValues.push('UNSEEN', String(stats.unseenCount));
              break;
            case 'UIDNEXT':
              itemValues.push('UIDNEXT', String(mailbox.uidNext));
              break;
            case 'UIDVALIDITY':
              itemValues.push('UIDVALIDITY', String(mailbox.uidValidity));
              break;
            default:
              responses.push(toTagged(command.tag, 'BAD', `Unsupported STATUS data item: ${item}`));
              return { responses, closeConnection: false };
          }
        }

        responses.push(
          toUntagged(`STATUS "${escapeImapString(mailbox.name)}" (${itemValues.join(' ')})`),
        );
        responses.push(toTagged(command.tag, 'OK', 'STATUS completed'));
        return { responses, closeConnection: false };
      }

      case 'CLOSE': {
        if (session.state !== 'SELECTED' || !session.selectedMailbox) {
          responses.push(toTagged(command.tag, 'BAD', 'No mailbox selected'));
          return { responses, closeConnection: false };
        }

        const mailboxId = session.selectedMailbox;
        await store.expungeDeletedMessages(mailboxId);

        const remaining = await store.listMessageMeta(mailboxId);
        const remainingStats = toMailboxStats(remaining);

        await store.updateMailboxCounters(
          mailboxId,
          remainingStats.exists,
          remainingStats.unseenCount,
        );

        session.state = 'AUTHENTICATED';
        session.selectedMailbox = null;

        responses.push(toTagged(command.tag, 'OK', 'CLOSE completed'));
        return { responses, closeConnection: false };
      }

      default:
        responses.push(toTagged(command.tag, 'BAD', 'Unsupported mailbox command'));
        return { responses, closeConnection: false };
    }
  };
}
