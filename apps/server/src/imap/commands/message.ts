import { db, mailboxes, messageBodies, messages } from '@enclave/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { ImapCommand, ImapCommandResult, ImapSession } from '../types.js';

const IMAP_FLAG_ORDER = ['seen', 'answered', 'flagged', 'deleted', 'draft'] as const;

const IMAP_TO_DB_FLAG: Record<string, (typeof IMAP_FLAG_ORDER)[number]> = {
  '\\SEEN': 'seen',
  '\\ANSWERED': 'answered',
  '\\FLAGGED': 'flagged',
  '\\DELETED': 'deleted',
  '\\DRAFT': 'draft',
};

const SYSTEM_MAILBOXES: Record<string, 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive'> = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  trash: 'trash',
  archive: 'archive',
};

export const MESSAGE_COMMANDS = new Set([
  'FETCH',
  'STORE',
  'SEARCH',
  'COPY',
  'EXPUNGE',
  'UID',
  'APPEND',
] as const);

interface MessageRecord {
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

interface MessageBodyRecord {
  encryptedBody: Uint8Array;
  contentType: string;
}

interface MailboxRecord {
  id: string;
  userId: string;
  name: string;
  uidValidity: number;
  uidNext: number;
  messageCount: number;
  unreadCount: number;
}

interface MessageStore {
  listMessages: (mailboxId: string) => Promise<MessageRecord[]>;
  getMessageBody: (messageId: string) => Promise<MessageBodyRecord | null>;
  updateFlags: (entries: Array<{ messageId: string; flags: string[] }>) => Promise<void>;
  findMailboxByName: (userId: string, mailboxName: string) => Promise<MailboxRecord | null>;
  copyMessages: (params: {
    destinationMailbox: MailboxRecord;
    sourceMessages: MessageRecord[];
  }) => Promise<number[]>;
  deleteMessagesByIds: (messageIds: string[]) => Promise<void>;
  updateMailboxCounters: (
    mailboxId: string,
    messageCount: number,
    unreadCount: number,
    uidNext?: number,
  ) => Promise<void>;
  appendStubMessage: (userId: string, mailboxName: string, literalSize: number) => Promise<boolean>;
}

type FetchResponse = string | Uint8Array;

interface IndexedMessage {
  sequence: number;
  message: MessageRecord;
}

interface ParsedStoreOperation {
  mode: 'add' | 'remove' | 'replace';
  silent: boolean;
  flags: string[];
}

type SearchPredicate = (input: IndexedMessage[]) => IndexedMessage[];

function toUntagged(response: string): string {
  return `* ${response}\r\n`;
}

function toTagged(tag: string, status: 'OK' | 'NO' | 'BAD', message: string): string {
  return `${tag} ${status} ${message}\r\n`;
}

function toBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function joinLiteralSegments(segments: Array<string | Uint8Array>): FetchResponse {
  const hasBinary = segments.some((segment) => segment instanceof Uint8Array);
  if (!hasBinary) {
    return segments.map((segment) => (typeof segment === 'string' ? segment : '')).join('');
  }

  let totalLength = 0;
  const prepared = segments.map((segment) => {
    if (typeof segment === 'string') {
      const encoded = toBytes(segment);
      totalLength += encoded.length;
      return encoded;
    }

    totalLength += segment.length;
    return segment;
  });

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of prepared) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function escapeImapString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function normalizeDbFlags(input: string[]): string[] {
  const normalized = new Set<string>();
  for (const value of input) {
    const lower = value.trim().toLowerCase();
    if (IMAP_FLAG_ORDER.includes(lower as (typeof IMAP_FLAG_ORDER)[number])) {
      normalized.add(lower);
    }
  }

  return IMAP_FLAG_ORDER.filter((flag) => normalized.has(flag));
}

function toImapFlags(flags: string[]): string {
  const normalized = new Set(normalizeDbFlags(flags));
  const imapFlags: string[] = [];

  if (normalized.has('seen')) {
    imapFlags.push('\\Seen');
  }
  if (normalized.has('answered')) {
    imapFlags.push('\\Answered');
  }
  if (normalized.has('flagged')) {
    imapFlags.push('\\Flagged');
  }
  if (normalized.has('deleted')) {
    imapFlags.push('\\Deleted');
  }
  if (normalized.has('draft')) {
    imapFlags.push('\\Draft');
  }

  return `(${imapFlags.join(' ')})`;
}

function parseFlagList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    return [];
  }

  const tokens = trimmed
    .slice(1, -1)
    .trim()
    .split(/\s+/)
    .filter((entry) => entry.length > 0);

  const result = new Set<string>();
  for (const token of tokens) {
    const mapped = IMAP_TO_DB_FLAG[token.toUpperCase()];
    if (mapped) {
      result.add(mapped);
    }
  }

  return IMAP_FLAG_ORDER.filter((flag) => result.has(flag));
}

function parseSequenceSet(rawSet: string, maxValue: number): Set<number> {
  const values = new Set<number>();
  if (rawSet.trim().length === 0 || maxValue <= 0) {
    return values;
  }

  for (const chunk of rawSet.split(',')) {
    const token = chunk.trim();
    if (!token) {
      continue;
    }

    const [startRaw = '', endRaw] = token.split(':');
    if (endRaw === undefined) {
      const numeric = startRaw === '*' ? maxValue : Number.parseInt(startRaw, 10);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= maxValue) {
        values.add(numeric);
      }
      continue;
    }

    const start = startRaw === '*' ? maxValue : Number.parseInt(startRaw, 10);
    const end = endRaw === '*' ? maxValue : Number.parseInt(endRaw, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      continue;
    }

    const low = Math.max(1, Math.min(start, end));
    const high = Math.min(maxValue, Math.max(start, end));
    for (let current = low; current <= high; current += 1) {
      values.add(current);
    }
  }

  return values;
}

function parseFetchItems(args: string[]): string[] {
  const joined = args.join(' ').trim();
  if (!joined) {
    return [];
  }

  let content = joined;
  if (content.startsWith('(') && content.endsWith(')')) {
    content = content.slice(1, -1);
  }

  return content
    .trim()
    .split(/\s+/)
    .map((entry) => entry.toUpperCase())
    .filter((entry) => entry.length > 0);
}

function formatImapDate(value: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const day = value.getUTCDate().toString().padStart(2, '0');
  const month = months[value.getUTCMonth()] ?? 'Jan';
  const year = value.getUTCFullYear().toString();
  const hours = value.getUTCHours().toString().padStart(2, '0');
  const minutes = value.getUTCMinutes().toString().padStart(2, '0');
  const seconds = value.getUTCSeconds().toString().padStart(2, '0');

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds} +0000`;
}

function parseAddress(value: string): { local: string; domain: string } {
  const [localPart, domainPart] = value.split('@');
  const local = localPart && localPart.length > 0 ? localPart : 'unknown';
  const domain = domainPart && domainPart.length > 0 ? domainPart : 'localhost';
  return { local, domain };
}

function formatAddressList(addresses: string[]): string {
  if (addresses.length === 0) {
    return 'NIL';
  }

  const entries = addresses.map((address) => {
    const parsed = parseAddress(address);
    return `(NIL NIL "${escapeImapString(parsed.local)}" "${escapeImapString(parsed.domain)}")`;
  });

  return `(${entries.join(' ')})`;
}

function formatEnvelope(message: MessageRecord): string {
  const date = message.date.toUTCString();
  const from = formatAddressList([message.fromAddress]);
  const to = formatAddressList(message.toAddresses);
  const messageId = message.messageId ? `"${escapeImapString(message.messageId)}"` : 'NIL';

  return `("${escapeImapString(date)}" "" ${from} NIL NIL NIL ${to} NIL NIL NIL ${messageId})`;
}

function formatBodyStructure(size: number): string {
  return `("TEXT" "PLAIN" NIL NIL NIL "BASE64" ${size})`;
}

function formatHeaderBlock(message: MessageRecord): string {
  const headers = [
    `From: ${message.fromAddress}`,
    `To: ${message.toAddresses.join(', ')}`,
    `Date: ${message.date.toUTCString()}`,
    message.messageId ? `Message-ID: ${message.messageId}` : null,
  ].filter((line): line is string => line !== null);

  return `${headers.join('\r\n')}\r\n\r\n`;
}

function buildFetchResponse(
  sequence: number,
  message: MessageRecord,
  items: string[],
  body: MessageBodyRecord | null,
): FetchResponse {
  const segments: Array<string | Uint8Array> = [`* ${sequence} FETCH (`];

  const pushWithSeparator = (value: string) => {
    if (segments.length > 1) {
      segments.push(' ');
    }
    segments.push(value);
  };

  const pushLiteral = (label: string, literal: Uint8Array) => {
    if (segments.length > 1) {
      segments.push(' ');
    }
    segments.push(`${label} {${literal.length}}\r\n`);
    segments.push(literal);
  };

  for (const item of items) {
    switch (item) {
      case 'FLAGS':
        pushWithSeparator(`FLAGS ${toImapFlags(message.flags)}`);
        break;
      case 'ENVELOPE':
        pushWithSeparator(`ENVELOPE ${formatEnvelope(message)}`);
        break;
      case 'BODY':
      case 'BODYSTRUCTURE':
        pushWithSeparator(`${item} ${formatBodyStructure(message.size)}`);
        break;
      case 'RFC822.SIZE':
        pushWithSeparator(`RFC822.SIZE ${message.size}`);
        break;
      case 'UID':
        pushWithSeparator(`UID ${message.uid}`);
        break;
      case 'INTERNALDATE':
        pushWithSeparator(`INTERNALDATE "${formatImapDate(message.date)}"`);
        break;
      case 'BODY[HEADER]': {
        const headerBytes = toBytes(formatHeaderBlock(message));
        pushLiteral('BODY[HEADER]', headerBytes);
        break;
      }
      case 'BODY[]':
      case 'BODY[TEXT]': {
        const encryptedBody = body?.encryptedBody ?? new Uint8Array();
        pushLiteral(item, encryptedBody);
        break;
      }
      default:
        pushWithSeparator(item);
        break;
    }
  }

  segments.push(')\r\n');
  return joinLiteralSegments(segments);
}

function parseStoreOperation(args: string[]): ParsedStoreOperation | null {
  const modeRaw = args[0]?.toUpperCase();
  if (!modeRaw) {
    return null;
  }

  const silent = modeRaw.endsWith('.SILENT');
  const baseMode = silent ? modeRaw.slice(0, -'.SILENT'.length) : modeRaw;

  let mode: ParsedStoreOperation['mode'];
  if (baseMode === '+FLAGS') {
    mode = 'add';
  } else if (baseMode === '-FLAGS') {
    mode = 'remove';
  } else if (baseMode === 'FLAGS') {
    mode = 'replace';
  } else {
    return null;
  }

  const flagRaw = args.slice(1).join(' ');
  const flags = parseFlagList(flagRaw);
  if (flags.length === 0 && flagRaw.trim() !== '()') {
    return null;
  }

  return { mode, silent, flags };
}

function applyStoreFlags(existing: string[], operation: ParsedStoreOperation): string[] {
  const current = new Set(normalizeDbFlags(existing));

  if (operation.mode === 'replace') {
    return normalizeDbFlags(operation.flags);
  }

  if (operation.mode === 'add') {
    for (const flag of operation.flags) {
      current.add(flag);
    }
  }

  if (operation.mode === 'remove') {
    for (const flag of operation.flags) {
      current.delete(flag);
    }
  }

  return IMAP_FLAG_ORDER.filter((flag) => current.has(flag));
}

function parseImapDate(input: string): Date | null {
  const normalized = input.trim();
  if (!normalized) {
    return null;
  }

  const monthMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const ddMmmYyyy = normalized.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (ddMmmYyyy) {
    const day = Number.parseInt(ddMmmYyyy[1] ?? '0', 10);
    const month = monthMap[(ddMmmYyyy[2] ?? '').toLowerCase()];
    const year = Number.parseInt(ddMmmYyyy[3] ?? '0', 10);
    if (!Number.isNaN(day) && month !== undefined && !Number.isNaN(year)) {
      return new Date(Date.UTC(year, month, day, 0, 0, 0));
    }
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 0, 0, 0),
  );
}

function sameUtcDate(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function parseUidSubcommand(command: ImapCommand): {
  subcommand: 'FETCH' | 'STORE' | 'SEARCH' | 'COPY' | null;
  args: string[];
} {
  const subcommandRaw = command.args[0]?.toUpperCase();
  if (!subcommandRaw) {
    return { subcommand: null, args: [] };
  }

  if (
    subcommandRaw !== 'FETCH' &&
    subcommandRaw !== 'STORE' &&
    subcommandRaw !== 'SEARCH' &&
    subcommandRaw !== 'COPY'
  ) {
    return { subcommand: null, args: [] };
  }

  return { subcommand: subcommandRaw, args: command.args.slice(1) };
}

function resolveTargetMessages(
  indexed: IndexedMessage[],
  rawSet: string,
  useUids: boolean,
): IndexedMessage[] {
  const maxValue = useUids
    ? indexed.reduce((max, entry) => Math.max(max, entry.message.uid), 0)
    : indexed.length;
  const wanted = parseSequenceSet(rawSet, maxValue);

  if (useUids) {
    return indexed.filter((entry) => wanted.has(entry.message.uid));
  }

  return indexed.filter((entry) => wanted.has(entry.sequence));
}

function unreadCount(messagesInput: MessageRecord[]): number {
  let count = 0;
  for (const message of messagesInput) {
    if (!message.flags.includes('seen')) {
      count += 1;
    }
  }
  return count;
}

function isSelectedSession(session: ImapSession): session is ImapSession & {
  state: 'SELECTED';
  userId: string;
  selectedMailbox: string;
} {
  return (
    session.state === 'SELECTED' &&
    typeof session.userId === 'string' &&
    session.userId.length > 0 &&
    typeof session.selectedMailbox === 'string' &&
    session.selectedMailbox.length > 0
  );
}

function isAuthenticatedSession(session: ImapSession): session is ImapSession & { userId: string } {
  return (
    (session.state === 'AUTHENTICATED' || session.state === 'SELECTED') &&
    typeof session.userId === 'string' &&
    session.userId.length > 0
  );
}

function createDrizzleMessageStore(): MessageStore {
  const findMailboxByName = async (
    userId: string,
    mailboxName: string,
  ): Promise<MailboxRecord | null> => {
    const normalizedName = mailboxName.trim();
    const systemType = SYSTEM_MAILBOXES[normalizedName.toLowerCase()];

    const rows =
      systemType !== undefined
        ? await db
            .select({
              id: mailboxes.id,
              userId: mailboxes.userId,
              name: mailboxes.name,
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
              uidValidity: mailboxes.uidValidity,
              uidNext: mailboxes.uidNext,
              messageCount: mailboxes.messageCount,
              unreadCount: mailboxes.unreadCount,
            })
            .from(mailboxes)
            .where(and(eq(mailboxes.userId, userId), eq(mailboxes.name, normalizedName)))
            .limit(1);

    return rows[0] ?? null;
  };

  return {
    listMessages: async (mailboxId) => {
      return db
        .select({
          id: messages.id,
          mailboxId: messages.mailboxId,
          uid: messages.uid,
          messageId: messages.messageId,
          inReplyTo: messages.inReplyTo,
          fromAddress: messages.fromAddress,
          toAddresses: messages.toAddresses,
          subjectEncrypted: messages.subjectEncrypted,
          date: messages.date,
          flags: messages.flags,
          size: messages.size,
          dkimStatus: messages.dkimStatus,
          spfStatus: messages.spfStatus,
          dmarcStatus: messages.dmarcStatus,
        })
        .from(messages)
        .where(eq(messages.mailboxId, mailboxId))
        .orderBy(asc(messages.uid));
    },
    getMessageBody: async (messageId) => {
      const rows = await db
        .select({
          encryptedBody: messageBodies.encryptedBody,
          contentType: messageBodies.contentType,
        })
        .from(messageBodies)
        .where(eq(messageBodies.messageId, messageId))
        .limit(1);

      return rows[0] ?? null;
    },
    updateFlags: async (entries) => {
      if (entries.length === 0) {
        return;
      }

      await db.transaction(async (tx) => {
        for (const entry of entries) {
          await tx
            .update(messages)
            .set({
              flags: normalizeDbFlags(entry.flags),
              updatedAt: new Date(),
            })
            .where(eq(messages.id, entry.messageId));
        }
      });
    },
    findMailboxByName,
    copyMessages: async ({ destinationMailbox, sourceMessages }) => {
      if (sourceMessages.length === 0) {
        return [];
      }

      return db.transaction(async (tx) => {
        const destinationRows = await tx
          .select({
            uidNext: mailboxes.uidNext,
            messageCount: mailboxes.messageCount,
            unreadCount: mailboxes.unreadCount,
          })
          .from(mailboxes)
          .where(eq(mailboxes.id, destinationMailbox.id))
          .limit(1);

        const destination = destinationRows[0];
        if (!destination) {
          return [];
        }

        const destinationUids: number[] = [];
        let nextUid = destination.uidNext;
        let unreadDelta = 0;

        for (const sourceMessage of sourceMessages) {
          const copiedRows = await tx
            .insert(messages)
            .values({
              mailboxId: destinationMailbox.id,
              uid: nextUid,
              messageId: sourceMessage.messageId,
              inReplyTo: sourceMessage.inReplyTo,
              fromAddress: sourceMessage.fromAddress,
              toAddresses: sourceMessage.toAddresses,
              subjectEncrypted: sourceMessage.subjectEncrypted,
              date: sourceMessage.date,
              flags: normalizeDbFlags(sourceMessage.flags),
              size: sourceMessage.size,
              dkimStatus: sourceMessage.dkimStatus,
              spfStatus: sourceMessage.spfStatus,
              dmarcStatus: sourceMessage.dmarcStatus,
            })
            .returning({ id: messages.id });

          const copied = copiedRows[0];
          if (!copied) {
            continue;
          }

          const sourceBodyRows = await tx
            .select({
              encryptedBody: messageBodies.encryptedBody,
              contentType: messageBodies.contentType,
              encryptionMetadata: messageBodies.encryptionMetadata,
            })
            .from(messageBodies)
            .where(eq(messageBodies.messageId, sourceMessage.id))
            .limit(1);

          const sourceBody = sourceBodyRows[0];
          if (sourceBody) {
            await tx.insert(messageBodies).values({
              messageId: copied.id,
              encryptedBody: sourceBody.encryptedBody,
              contentType: sourceBody.contentType,
              encryptionMetadata: sourceBody.encryptionMetadata,
            });
          }

          destinationUids.push(nextUid);
          if (!sourceMessage.flags.includes('seen')) {
            unreadDelta += 1;
          }

          nextUid += 1;
        }

        await tx
          .update(mailboxes)
          .set({
            uidNext: destination.uidNext + destinationUids.length,
            messageCount: destination.messageCount + destinationUids.length,
            unreadCount: destination.unreadCount + unreadDelta,
            updatedAt: new Date(),
          })
          .where(eq(mailboxes.id, destinationMailbox.id));

        return destinationUids;
      });
    },
    deleteMessagesByIds: async (messageIds) => {
      if (messageIds.length === 0) {
        return;
      }

      await db.delete(messages).where(inArray(messages.id, messageIds));
    },
    updateMailboxCounters: async (mailboxId, messageCount, unreadCount, uidNext) => {
      const updatePayload: {
        messageCount: number;
        unreadCount: number;
        updatedAt: Date;
        uidNext?: number;
      } = {
        messageCount,
        unreadCount,
        updatedAt: new Date(),
      };

      if (uidNext !== undefined) {
        updatePayload.uidNext = uidNext;
      }

      await db.update(mailboxes).set(updatePayload).where(eq(mailboxes.id, mailboxId));
    },
    appendStubMessage: async (userId, mailboxName, literalSize) => {
      const mailbox = await findMailboxByName(userId, mailboxName);
      if (!mailbox) {
        return false;
      }

      return db.transaction(async (tx) => {
        await tx.insert(messages).values({
          mailboxId: mailbox.id,
          uid: mailbox.uidNext,
          messageId: `append-${Date.now()}`,
          fromAddress: 'unknown@localhost',
          toAddresses: [],
          subjectEncrypted: null,
          date: new Date(),
          flags: [],
          size: Math.max(0, literalSize),
        });

        await tx
          .update(mailboxes)
          .set({
            uidNext: mailbox.uidNext + 1,
            messageCount: mailbox.messageCount + 1,
            unreadCount: mailbox.unreadCount + 1,
            updatedAt: new Date(),
          })
          .where(eq(mailboxes.id, mailbox.id));

        return true;
      });
    },
  };
}

export type MessageCommandHandler = (
  session: ImapSession,
  command: ImapCommand,
) => Promise<ImapCommandResult>;

function createSearchPredicates(
  args: string[],
  indexedMessages: IndexedMessage[],
): { predicates: SearchPredicate[]; error: string | null } {
  if (args.length === 0) {
    return { predicates: [(_values) => indexedMessages], error: null };
  }

  const predicates: SearchPredicate[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const tokenRaw = args[index];
    if (!tokenRaw) {
      continue;
    }

    const token = tokenRaw.toUpperCase();
    switch (token) {
      case 'ALL':
        predicates.push((values) => values);
        break;
      case 'SEEN':
        predicates.push((values) => values.filter((entry) => entry.message.flags.includes('seen')));
        break;
      case 'UNSEEN':
        predicates.push((values) =>
          values.filter((entry) => !entry.message.flags.includes('seen')),
        );
        break;
      case 'FLAGGED':
        predicates.push((values) =>
          values.filter((entry) => entry.message.flags.includes('flagged')),
        );
        break;
      case 'UNFLAGGED':
        predicates.push((values) =>
          values.filter((entry) => !entry.message.flags.includes('flagged')),
        );
        break;
      case 'DELETED':
        predicates.push((values) =>
          values.filter((entry) => entry.message.flags.includes('deleted')),
        );
        break;
      case 'UNDELETED':
        predicates.push((values) =>
          values.filter((entry) => !entry.message.flags.includes('deleted')),
        );
        break;
      case 'DRAFT':
        predicates.push((values) =>
          values.filter((entry) => entry.message.flags.includes('draft')),
        );
        break;
      case 'UNDRAFT':
        predicates.push((values) =>
          values.filter((entry) => !entry.message.flags.includes('draft')),
        );
        break;
      case 'FROM': {
        const value = args[index + 1];
        if (!value) {
          return { predicates: [], error: 'FROM requires search string' };
        }
        index += 1;
        const lowered = value.toLowerCase();
        predicates.push((values) =>
          values.filter((entry) => entry.message.fromAddress.toLowerCase().includes(lowered)),
        );
        break;
      }
      case 'TO': {
        const value = args[index + 1];
        if (!value) {
          return { predicates: [], error: 'TO requires search string' };
        }
        index += 1;
        const lowered = value.toLowerCase();
        predicates.push((values) =>
          values.filter((entry) =>
            entry.message.toAddresses.some((address) => address.toLowerCase().includes(lowered)),
          ),
        );
        break;
      }
      case 'BEFORE':
      case 'SINCE':
      case 'ON': {
        const value = args[index + 1];
        if (!value) {
          return { predicates: [], error: `${token} requires date value` };
        }
        index += 1;
        const target = parseImapDate(value);
        if (!target) {
          return { predicates: [], error: `${token} invalid date` };
        }

        if (token === 'ON') {
          predicates.push((values) =>
            values.filter((entry) =>
              sameUtcDate(
                new Date(
                  Date.UTC(
                    entry.message.date.getUTCFullYear(),
                    entry.message.date.getUTCMonth(),
                    entry.message.date.getUTCDate(),
                    0,
                    0,
                    0,
                  ),
                ),
                target,
              ),
            ),
          );
        }

        if (token === 'BEFORE') {
          predicates.push((values) =>
            values.filter((entry) => {
              const messageDate = new Date(
                Date.UTC(
                  entry.message.date.getUTCFullYear(),
                  entry.message.date.getUTCMonth(),
                  entry.message.date.getUTCDate(),
                  0,
                  0,
                  0,
                ),
              );
              return messageDate.getTime() < target.getTime();
            }),
          );
        }

        if (token === 'SINCE') {
          predicates.push((values) =>
            values.filter((entry) => {
              const messageDate = new Date(
                Date.UTC(
                  entry.message.date.getUTCFullYear(),
                  entry.message.date.getUTCMonth(),
                  entry.message.date.getUTCDate(),
                  0,
                  0,
                  0,
                ),
              );
              return messageDate.getTime() >= target.getTime();
            }),
          );
        }

        break;
      }
      case 'SMALLER':
      case 'LARGER': {
        const value = args[index + 1];
        if (!value) {
          return { predicates: [], error: `${token} requires numeric value` };
        }
        index += 1;
        const numeric = Number.parseInt(value, 10);
        if (!Number.isInteger(numeric)) {
          return { predicates: [], error: `${token} requires numeric value` };
        }

        if (token === 'SMALLER') {
          predicates.push((values) => values.filter((entry) => entry.message.size < numeric));
        } else {
          predicates.push((values) => values.filter((entry) => entry.message.size > numeric));
        }
        break;
      }
      case 'UID': {
        const value = args[index + 1];
        if (!value) {
          return { predicates: [], error: 'UID requires set value' };
        }
        index += 1;
        const maxUid = indexedMessages.reduce((max, entry) => Math.max(max, entry.message.uid), 0);
        const uidSet = parseSequenceSet(value, maxUid);
        predicates.push((values) => values.filter((entry) => uidSet.has(entry.message.uid)));
        break;
      }
      default:
        return { predicates: [], error: `Unsupported SEARCH criteria: ${token}` };
    }
  }

  return { predicates, error: null };
}

function parseAppendLiteralSize(rawValue: string | undefined): number {
  if (!rawValue) {
    return 0;
  }

  const match = rawValue.match(/^\{(\d+)\}$/);
  if (!match) {
    return 0;
  }

  return Number.parseInt(match[1] ?? '0', 10);
}

export function createMessageCommandHandler(
  store: MessageStore = createDrizzleMessageStore(),
): MessageCommandHandler {
  return async (session, command) => {
    const responses: Array<string | Uint8Array> = [];

    if (command.command === 'APPEND') {
      if (!isAuthenticatedSession(session)) {
        responses.push(toTagged(command.tag, 'BAD', 'Not authenticated'));
        return { responses, closeConnection: false };
      }

      const mailboxName = command.args[0];
      if (!mailboxName) {
        responses.push(toTagged(command.tag, 'BAD', 'APPEND requires mailbox name'));
        return { responses, closeConnection: false };
      }

      const literalToken = command.args[command.args.length - 1];
      const literalSize = parseAppendLiteralSize(literalToken);
      const appended = await store.appendStubMessage(session.userId, mailboxName, literalSize);
      if (!appended) {
        responses.push(toTagged(command.tag, 'NO', 'APPEND failed'));
        return { responses, closeConnection: false };
      }

      responses.push(toTagged(command.tag, 'OK', 'APPEND completed'));
      return { responses, closeConnection: false };
    }

    if (!isSelectedSession(session)) {
      responses.push(toTagged(command.tag, 'BAD', 'Not in selected state'));
      return { responses, closeConnection: false };
    }

    const selectedMailboxId = session.selectedMailbox;
    const listedMessages = await store.listMessages(selectedMailboxId);
    const indexedMessages: IndexedMessage[] = listedMessages.map((message, index) => ({
      sequence: index + 1,
      message,
    }));

    let commandName = command.command;
    let commandArgs = command.args;
    let useUids = false;

    if (command.command === 'UID') {
      const parsedUid = parseUidSubcommand(command);
      if (!parsedUid.subcommand) {
        responses.push(toTagged(command.tag, 'BAD', 'UID requires FETCH, STORE, SEARCH, or COPY'));
        return { responses, closeConnection: false };
      }

      commandName = parsedUid.subcommand;
      commandArgs = parsedUid.args;
      useUids = true;
    }

    switch (commandName) {
      case 'FETCH': {
        const sequenceSet = commandArgs[0];
        if (!sequenceSet) {
          responses.push(toTagged(command.tag, 'BAD', 'FETCH requires sequence set'));
          return { responses, closeConnection: false };
        }

        const items = parseFetchItems(commandArgs.slice(1));
        if (items.length === 0) {
          responses.push(toTagged(command.tag, 'BAD', 'FETCH requires data items'));
          return { responses, closeConnection: false };
        }

        const targets = resolveTargetMessages(indexedMessages, sequenceSet, useUids);

        for (const target of targets) {
          let body: MessageBodyRecord | null = null;
          if (items.includes('BODY[]') || items.includes('BODY[TEXT]')) {
            body = await store.getMessageBody(target.message.id);
          }

          responses.push(buildFetchResponse(target.sequence, target.message, items, body));
        }

        responses.push(toTagged(command.tag, 'OK', `${useUids ? 'UID ' : ''}FETCH completed`));
        return { responses, closeConnection: false };
      }

      case 'STORE': {
        const sequenceSet = commandArgs[0];
        if (!sequenceSet) {
          responses.push(toTagged(command.tag, 'BAD', 'STORE requires sequence set'));
          return { responses, closeConnection: false };
        }

        const operation = parseStoreOperation(commandArgs.slice(1));
        if (!operation) {
          responses.push(toTagged(command.tag, 'BAD', 'STORE requires valid flag operation'));
          return { responses, closeConnection: false };
        }

        const targets = resolveTargetMessages(indexedMessages, sequenceSet, useUids);
        const updates = targets.map((target) => ({
          messageId: target.message.id,
          flags: applyStoreFlags(target.message.flags, operation),
        }));

        await store.updateFlags(updates);

        for (const update of updates) {
          const entry = indexedMessages.find((item) => item.message.id === update.messageId);
          if (entry) {
            entry.message.flags = update.flags;
          }
        }

        if (!operation.silent) {
          for (const target of targets) {
            const updatedFlags = indexedMessages.find(
              (entry) => entry.message.id === target.message.id,
            )?.message.flags;
            const uidSegment = useUids ? ` UID ${target.message.uid}` : '';
            responses.push(
              toUntagged(
                `${target.sequence} FETCH (FLAGS ${toImapFlags(updatedFlags ?? [])}${uidSegment})`,
              ),
            );
          }
        }

        responses.push(toTagged(command.tag, 'OK', `${useUids ? 'UID ' : ''}STORE completed`));
        return { responses, closeConnection: false };
      }

      case 'SEARCH': {
        const { predicates, error } = createSearchPredicates(commandArgs, indexedMessages);
        if (error) {
          responses.push(toTagged(command.tag, 'BAD', error));
          return { responses, closeConnection: false };
        }

        let filtered = indexedMessages;
        for (const predicate of predicates) {
          filtered = predicate(filtered);
        }

        const numbers = useUids
          ? filtered.map((entry) => entry.message.uid)
          : filtered.map((entry) => entry.sequence);
        responses.push(toUntagged(`SEARCH${numbers.length > 0 ? ` ${numbers.join(' ')}` : ''}`));
        responses.push(toTagged(command.tag, 'OK', `${useUids ? 'UID ' : ''}SEARCH completed`));
        return { responses, closeConnection: false };
      }

      case 'COPY': {
        const sequenceSet = commandArgs[0];
        const destinationMailboxName = commandArgs[1];
        if (!sequenceSet || !destinationMailboxName) {
          responses.push(
            toTagged(command.tag, 'BAD', 'COPY requires sequence set and destination mailbox'),
          );
          return { responses, closeConnection: false };
        }

        const destinationMailbox = await store.findMailboxByName(
          session.userId,
          destinationMailboxName,
        );
        if (!destinationMailbox) {
          responses.push(toTagged(command.tag, 'NO', 'COPY failed'));
          return { responses, closeConnection: false };
        }

        const targets = resolveTargetMessages(indexedMessages, sequenceSet, useUids);
        const sourceMessages = targets.map((entry) => entry.message);
        const destinationUids = await store.copyMessages({
          destinationMailbox,
          sourceMessages,
        });

        const sourceUidList = sourceMessages.map((message) => message.uid).join(',');
        const destinationUidList = destinationUids.join(',');
        responses.push(
          toTagged(
            command.tag,
            'OK',
            `[COPYUID ${destinationMailbox.uidValidity} ${sourceUidList} ${destinationUidList}] COPY completed`,
          ),
        );
        return { responses, closeConnection: false };
      }

      case 'EXPUNGE': {
        const deletions = indexedMessages.filter((entry) =>
          entry.message.flags.includes('deleted'),
        );
        const deleteIds = deletions.map((entry) => entry.message.id);

        if (deleteIds.length > 0) {
          await store.deleteMessagesByIds(deleteIds);
        }

        for (const entry of deletions.sort((left, right) => right.sequence - left.sequence)) {
          responses.push(toUntagged(`${entry.sequence} EXPUNGE`));
        }

        const remaining = indexedMessages
          .filter((entry) => !deleteIds.includes(entry.message.id))
          .map((entry) => entry.message);
        await store.updateMailboxCounters(
          selectedMailboxId,
          remaining.length,
          unreadCount(remaining),
        );

        responses.push(toTagged(command.tag, 'OK', 'EXPUNGE completed'));
        return { responses, closeConnection: false };
      }

      default:
        responses.push(toTagged(command.tag, 'BAD', 'Unsupported message command'));
        return { responses, closeConnection: false };
    }
  };
}
