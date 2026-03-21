import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';

import { resolveMx } from 'node:dns/promises';
import {
  attachmentBlobs,
  db,
  keypairs,
  mailboxes,
  messageBodies,
  messages,
  users,
} from '@enclave/db';
import { type OutboundMailJob, QUEUE_NAMES } from '@enclave/types';
import type { Job, Worker } from 'bullmq';
import { Worker as BullWorker } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';

import { decryptBlob, decryptMimeBody } from '../lib/mime-encryption.js';
import { loadDkimPrivateKey, signMessage } from '../smtp/dkim.js';
import { createRecipientEncryptor } from '../smtp/encrypt.js';
import { OUTBOUND_RETRY_DELAYS_MS } from '../smtp/outbound.js';
import { createRedisConnection } from './connection.js';
import { createDeadLetterQueue } from './mail-queue.js';
import type { DeadLetterJob } from './types.js';

type MxRecord = { exchange: string; priority: number };

interface OutboundJobContext {
  id?: string | number;
  data: OutboundMailJob;
  attemptsMade: number;
  opts: {
    attempts?: number;
  };
}

interface LoadedOutboundMessage {
  messageId: string;
  fromAddress: string;
  toAddresses: string[];
  date: Date;
  subjectEncrypted: Buffer | null;
  encryptedBody: Buffer;
  contentType: string;
}

interface OutboundDataStore {
  loadMessageById: (messageId: string) => Promise<LoadedOutboundMessage | null>;
  markDelivered: (messageId: string, deliveredAtIso: string) => Promise<void>;
  markFailed: (messageId: string, errorMessage: string, isDead: boolean) => Promise<void>;
  createBounceNotification: (job: OutboundMailJob, reason: string) => Promise<void>;
}

interface RelayEnvelope {
  from: string;
  to: string[];
  message: string;
  ehloDomain: string;
}

interface OutboundWorkerDeps {
  resolveMxFn: (domain: string) => Promise<MxRecord[]>;
  relayFn: (mxHost: string, envelope: RelayEnvelope) => Promise<void>;
  loadDkimPrivateKeyFn: () => Promise<string>;
  signMessageFn: (
    rawEmail: string,
    domain: string,
    selector: string,
    privateKeyPem: string,
  ) => Promise<string>;
  dataStore: OutboundDataStore;
  deadLetterQueue: {
    add: (name: string, data: DeadLetterJob) => Promise<unknown>;
  };
  smtpDomain: string;
  dkimSelector: string;
  nowIsoFn: () => string;
}

const SMTP_PORT = 25;
const SMTP_TIMEOUT_MS = 15_000;

export function sortMxRecordsByPriority(records: MxRecord[]): MxRecord[] {
  return [...records].sort((a, b) => a.priority - b.priority);
}

export function outboundBackoffDelay(attemptsMade: number): number {
  const index = Math.max(0, Math.min(attemptsMade - 1, OUTBOUND_RETRY_DELAYS_MS.length - 1));
  const delay = OUTBOUND_RETRY_DELAYS_MS[index];
  if (delay !== undefined) {
    return delay;
  }

  const fallback = OUTBOUND_RETRY_DELAYS_MS[OUTBOUND_RETRY_DELAYS_MS.length - 1];
  if (fallback === undefined) {
    throw new Error('Outbound retry delays are not configured');
  }

  return fallback;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseAddressDomain(address: string): string {
  const atIndex = address.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === address.length - 1) {
    throw new Error(`Invalid email address: ${address}`);
  }

  return address.slice(atIndex + 1).toLowerCase();
}

function groupRecipientsByDomain(recipients: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const recipient of recipients) {
    const domain = parseAddressDomain(recipient);
    const existing = grouped.get(domain);
    if (existing) {
      existing.push(recipient);
      continue;
    }

    grouped.set(domain, [recipient]);
  }

  return grouped;
}

function dotStuffMessage(message: string): string {
  return message.replace(/(^|\r\n)\./g, '$1..');
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r?\n/g, '\r\n');
}

async function connectTcp(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  const socket = net.connect({ host, port });
  socket.setTimeout(timeoutMs);

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new Error(`SMTP connection timed out to ${host}:${port}`));
    };
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
    };

    socket.on('connect', onConnect);
    socket.on('error', onError);
    socket.on('timeout', onTimeout);
  });

  return socket;
}

type SocketLike = net.Socket | tls.TLSSocket;

interface SmtpResponse {
  code: number;
  lines: string[];
}

function createLineReader(socket: SocketLike) {
  let buffer = '';
  const lineQueue: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, '');
      const waiter = waiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        lineQueue.push(line);
      }
    }
  };

  socket.on('data', onData);

  async function readLine(): Promise<string> {
    const queued = lineQueue.shift();
    if (queued !== undefined) {
      return queued;
    }

    return new Promise<string>((resolve) => {
      waiters.push(resolve);
    });
  }

  async function readResponse(): Promise<SmtpResponse> {
    const lines: string[] = [];
    while (true) {
      const line = await readLine();
      lines.push(line);

      const match = line.match(/^(\d{3})([ -])(.*)$/);
      if (!match) {
        throw new Error(`Invalid SMTP response line: ${line}`);
      }

      if (match[2] === ' ') {
        return {
          code: Number(match[1]),
          lines,
        };
      }
    }
  }

  function dispose(): void {
    socket.off('data', onData);
  }

  return { readResponse, dispose };
}

async function sendSmtpCommand(
  socket: SocketLike,
  reader: ReturnType<typeof createLineReader>,
  command: string,
): Promise<SmtpResponse> {
  socket.write(`${command}\r\n`);
  return reader.readResponse();
}

function responseHasStartTls(response: SmtpResponse): boolean {
  return response.lines.some((line) => line.toUpperCase().includes('STARTTLS'));
}

async function upgradeSocketToTls(
  socket: net.Socket,
  servername: string,
  timeoutMs: number,
): Promise<tls.TLSSocket> {
  try {
    return await attemptTlsUpgrade(socket, servername, timeoutMs, true);
  } catch (verifiedError) {
    const tlsError = verifiedError as NodeJS.ErrnoException;
    const errorCode = tlsError.code ?? 'UNKNOWN_TLS_ERROR';
    const errorMessage =
      tlsError instanceof Error
        ? tlsError.message
        : typeof tlsError === 'string'
          ? tlsError
          : String(tlsError);

    console.warn(
      `[outbound] STARTTLS certificate verification failed for host=${servername} code=${errorCode}: ${errorMessage}. Falling back to opportunistic TLS (certificate verification disabled).`,
    );

    try {
      return await attemptTlsUpgrade(socket, servername, timeoutMs, false);
    } catch (opportunisticError) {
      const fallbackError = opportunisticError as NodeJS.ErrnoException;
      const fallbackCode = fallbackError.code ?? 'UNKNOWN_TLS_ERROR';
      const fallbackMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : typeof fallbackError === 'string'
            ? fallbackError
            : String(fallbackError);

      console.warn(
        `[outbound] Opportunistic STARTTLS fallback failed for host=${servername} code=${fallbackCode}: ${fallbackMessage}`,
      );
      throw opportunisticError;
    }
  }
}

async function attemptTlsUpgrade(
  socket: net.Socket,
  servername: string,
  timeoutMs: number,
  rejectUnauthorized: boolean,
): Promise<tls.TLSSocket> {
  const secureSocket = tls.connect({
    socket,
    servername,
    rejectUnauthorized,
  });

  secureSocket.setTimeout(timeoutMs);

  await Promise.race([
    once(secureSocket, 'secureConnect').then(() => undefined),
    once(secureSocket, 'error').then(([error]) => {
      throw error instanceof Error ? error : new Error(String(error));
    }),
    new Promise<never>((_, reject) => {
      secureSocket.once('timeout', () => {
        secureSocket.destroy();
        reject(new Error(`STARTTLS handshake timed out for ${servername}`));
      });
    }),
  ]);

  return secureSocket;
}

async function relayWithSmtp(mxHost: string, envelope: RelayEnvelope): Promise<void> {
  const plainSocket = await connectTcp(mxHost, SMTP_PORT, SMTP_TIMEOUT_MS);
  let activeSocket: SocketLike = plainSocket;
  let reader = createLineReader(activeSocket);

  const closeConnection = () => {
    reader.dispose();
    if (!activeSocket.destroyed) {
      activeSocket.destroy();
    }
  };

  try {
    const banner = await reader.readResponse();
    if (banner.code !== 220) {
      throw new Error(`SMTP banner rejected by ${mxHost}: ${banner.lines.join(' | ')}`);
    }

    let ehloResponse = await sendSmtpCommand(activeSocket, reader, `EHLO ${envelope.ehloDomain}`);
    if (ehloResponse.code !== 250) {
      throw new Error(`EHLO rejected by ${mxHost}: ${ehloResponse.lines.join(' | ')}`);
    }

    if (responseHasStartTls(ehloResponse) && activeSocket instanceof net.Socket) {
      const startTlsResponse = await sendSmtpCommand(activeSocket, reader, 'STARTTLS');
      if (startTlsResponse.code === 220) {
        reader.dispose();
        activeSocket = await upgradeSocketToTls(activeSocket, mxHost, SMTP_TIMEOUT_MS);
        reader = createLineReader(activeSocket);

        ehloResponse = await sendSmtpCommand(activeSocket, reader, `EHLO ${envelope.ehloDomain}`);
        if (ehloResponse.code !== 250) {
          throw new Error(
            `EHLO after STARTTLS rejected by ${mxHost}: ${ehloResponse.lines.join(' | ')}`,
          );
        }
      }
    }

    const mailFromResponse = await sendSmtpCommand(
      activeSocket,
      reader,
      `MAIL FROM:<${envelope.from}>`,
    );
    if (mailFromResponse.code !== 250) {
      throw new Error(`MAIL FROM rejected by ${mxHost}: ${mailFromResponse.lines.join(' | ')}`);
    }

    for (const recipient of envelope.to) {
      const rcptResponse = await sendSmtpCommand(activeSocket, reader, `RCPT TO:<${recipient}>`);
      if (rcptResponse.code !== 250 && rcptResponse.code !== 251) {
        throw new Error(`RCPT TO rejected by ${mxHost}: ${rcptResponse.lines.join(' | ')}`);
      }
    }

    const dataResponse = await sendSmtpCommand(activeSocket, reader, 'DATA');
    if (dataResponse.code !== 354) {
      throw new Error(`DATA rejected by ${mxHost}: ${dataResponse.lines.join(' | ')}`);
    }

    const body = `${dotStuffMessage(normalizeLineEndings(envelope.message))}\r\n.\r\n`;
    activeSocket.write(body);
    const bodyAck = await reader.readResponse();
    if (bodyAck.code !== 250) {
      throw new Error(`Message body rejected by ${mxHost}: ${bodyAck.lines.join(' | ')}`);
    }

    const quitResponse = await sendSmtpCommand(activeSocket, reader, 'QUIT');
    if (quitResponse.code !== 221) {
      throw new Error(`QUIT rejected by ${mxHost}: ${quitResponse.lines.join(' | ')}`);
    }

    closeConnection();
  } catch (error) {
    closeConnection();
    throw error;
  }
}

function createDatabaseDataStore(): OutboundDataStore {
  return {
    async loadMessageById(messageId: string): Promise<LoadedOutboundMessage | null> {
      const rows = await db
        .select({
          messageId: messages.id,
          fromAddress: messages.fromAddress,
          toAddresses: messages.toAddresses,
          date: messages.date,
          subjectEncrypted: messages.subjectEncrypted,
          encryptedBody: messageBodies.encryptedBody,
          contentType: messageBodies.contentType,
        })
        .from(messages)
        .innerJoin(messageBodies, eq(messages.id, messageBodies.messageId))
        .where(eq(messages.id, messageId))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        messageId: row.messageId,
        fromAddress: row.fromAddress,
        toAddresses: row.toAddresses,
        date: row.date,
        subjectEncrypted: row.subjectEncrypted ? Buffer.from(row.subjectEncrypted) : null,
        encryptedBody: Buffer.from(row.encryptedBody),
        contentType: row.contentType,
      };
    },

    async markDelivered(messageId: string, deliveredAtIso: string): Promise<void> {
      await db
        .update(messages)
        .set({
          flags: sql`(case when jsonb_typeof(${messages.flags}) = 'object' then ${messages.flags} else '{}'::jsonb end) || jsonb_build_object('delivered', true, 'deliveredAt', ${deliveredAtIso})`,
          updatedAt: new Date(),
        })
        .where(eq(messages.id, messageId));
    },

    async markFailed(messageId: string, errorMessage: string, isDead: boolean): Promise<void> {
      await db
        .update(messages)
        .set({
          flags: sql`(case when jsonb_typeof(${messages.flags}) = 'object' then ${messages.flags} else '{}'::jsonb end) || jsonb_build_object('failed', true, 'error', ${errorMessage}, 'dead', ${isDead})`,
          updatedAt: new Date(),
        })
        .where(eq(messages.id, messageId));
    },

    async createBounceNotification(job: OutboundMailJob, reason: string): Promise<void> {
      const senderAddress = job.from.trim().toLowerCase();
      const smtpDomain = process.env.SMTP_DOMAIN ?? 'localhost';

      await db.transaction(async (tx) => {
        const senderRows = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, senderAddress))
          .limit(1);

        const sender = senderRows[0];
        if (!sender) {
          return;
        }

        const keypairRows = await tx
          .select({ publicKey: keypairs.publicKey })
          .from(keypairs)
          .where(
            and(
              eq(keypairs.userId, sender.id),
              eq(keypairs.type, 'x25519'),
              eq(keypairs.isActive, true),
            ),
          )
          .limit(1);

        const senderKeypair = keypairRows[0];
        if (!senderKeypair) {
          console.warn(`[bounce] no public key for ${senderAddress} — skipping bounce`);
          return;
        }

        const inboxRows = await tx
          .select({ id: mailboxes.id, uidNext: mailboxes.uidNext })
          .from(mailboxes)
          .where(and(eq(mailboxes.userId, sender.id), eq(mailboxes.type, 'inbox')))
          .limit(1);

        const inbox = inboxRows[0];
        if (!inbox) {
          return;
        }

        const now = new Date();
        const bounceBody = Buffer.from(
          `Delivery failed for message ${job.encryptedBodyRef}.\nReason: ${reason}`,
          'utf8',
        );
        const bounceSubject = Buffer.from('Bounce notification', 'utf8');
        const encryptor = createRecipientEncryptor(new Uint8Array(senderKeypair.publicKey));
        const encryptedBodyPayload = encryptor.encrypt(bounceBody);
        const encryptedSubjectPayload = encryptor.encrypt(bounceSubject);

        const inserted = await tx
          .insert(messages)
          .values({
            mailboxId: inbox.id,
            uid: inbox.uidNext,
            messageId: `bounce-${job.encryptedBodyRef}-${Date.now()}`,
            fromAddress: `mailer-daemon@${smtpDomain}`,
            toAddresses: [senderAddress],
            subjectEncrypted: encryptedSubjectPayload.ciphertext,
            date: now,
            flags: [],
            size: encryptedBodyPayload.ciphertext.length,
          })
          .returning({ id: messages.id });

        const bounceMessage = inserted[0];
        if (!bounceMessage) {
          return;
        }

        await tx.insert(messageBodies).values({
          messageId: bounceMessage.id,
          encryptedBody: encryptedBodyPayload.ciphertext,
          contentType: 'text/plain; charset=utf-8',
          encryptionMetadata: {
            algorithm: 'x25519-chacha20poly1305',
            ephemeralPublicKey: encryptedBodyPayload.ephemeralPublicKey.toString('hex'),
            bodyNonce: encryptedBodyPayload.nonce.toString('hex'),
            subjectNonce: encryptedSubjectPayload.nonce.toString('hex'),
          },
        });

        await tx
          .update(mailboxes)
          .set({
            uidNext: sql`${mailboxes.uidNext} + 1`,
            messageCount: sql`${mailboxes.messageCount} + 1`,
            unreadCount: sql`${mailboxes.unreadCount} + 1`,
            updatedAt: now,
          })
          .where(eq(mailboxes.id, inbox.id));
      });
    },
  };
}

function createDefaultDeps(overrides: Partial<OutboundWorkerDeps>): OutboundWorkerDeps {
  const deadLetterQueue = createDeadLetterQueue();

  return {
    resolveMxFn: async (domain: string) => {
      const resolved = await resolveMx(domain);
      return resolved.map((record) => ({ exchange: record.exchange, priority: record.priority }));
    },
    relayFn: relayWithSmtp,
    loadDkimPrivateKeyFn: loadDkimPrivateKey,
    signMessageFn: signMessage,
    dataStore: createDatabaseDataStore(),
    deadLetterQueue,
    smtpDomain: process.env.SMTP_DOMAIN ?? 'localhost',
    dkimSelector: process.env.DKIM_SELECTOR ?? 'mail',
    nowIsoFn: () => new Date().toISOString(),
    ...overrides,
  };
}

interface DecryptedAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

async function fetchAndDecryptAttachments(attachmentIds: string[]): Promise<DecryptedAttachment[]> {
  const results: DecryptedAttachment[] = [];

  for (const id of attachmentIds) {
    const rows = await db
      .select({
        filename: attachmentBlobs.filename,
        mimeType: attachmentBlobs.mimeType,
        encryptedBlob: attachmentBlobs.encryptedBlob,
        nonce: attachmentBlobs.nonce,
      })
      .from(attachmentBlobs)
      .where(eq(attachmentBlobs.id, id));

    const row = rows[0];
    if (!row) continue;

    const decrypted = decryptBlob(Buffer.from(row.encryptedBlob), row.nonce);
    results.push({
      filename: row.filename,
      mimeType: row.mimeType,
      data: decrypted,
    });
  }

  return results;
}

function assembleMultipartMime(htmlBody: string, attachments: DecryptedAttachment[]): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const parts: string[] = [];

  // HTML body part
  const bodyBase64 = Buffer.from(htmlBody, 'utf8').toString('base64');
  parts.push(
    `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${bodyBase64}\r\n`,
  );

  // Attachment parts
  for (const att of attachments) {
    const safeFilename = att.filename.replace(/"/g, '\\"');
    const attBase64 = att.data.toString('base64');
    parts.push(
      `--${boundary}\r\nContent-Type: ${att.mimeType}; name="${safeFilename}"\r\nContent-Disposition: attachment; filename="${safeFilename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${attBase64}\r\n`,
    );
  }

  // Closing boundary
  parts.push(`--${boundary}--\r\n`);

  return `Content-Type: multipart/mixed; boundary="${boundary}"\r\nMIME-Version: 1.0\r\n\r\n${parts.join('')}`;
}

export async function processOutboundMailJob(
  job: OutboundJobContext,
  overrideDeps: Partial<OutboundWorkerDeps> = {},
): Promise<void> {
  const deps = createDefaultDeps(overrideDeps);
  let mimeBody: string | undefined;

  try {
    const loadedMessage = await deps.dataStore.loadMessageById(job.data.encryptedBodyRef);
    if (!loadedMessage) {
      throw new Error(`Message not found for encryptedBodyRef=${job.data.encryptedBodyRef}`);
    }

    mimeBody = decryptMimeBody(job.data.encryptedMimeBody, job.data.mimeBodyNonce);

    // If the message has attachments, assemble multipart/mixed MIME
    const attachmentIds = job.data.attachmentIds;
    if (attachmentIds && attachmentIds.length > 0) {
      const attachments = await fetchAndDecryptAttachments(attachmentIds);
      if (attachments.length > 0) {
        mimeBody = assembleMultipartMime(mimeBody, attachments);
      }
    }

    const dkimDomain = parseAddressDomain(job.data.from);
    const privateKeyPem = await deps.loadDkimPrivateKeyFn();
    const signedMime = await deps.signMessageFn(
      mimeBody,
      dkimDomain,
      deps.dkimSelector,
      privateKeyPem,
    );
    const groupedRecipients = groupRecipientsByDomain(job.data.to);

    for (const [domain, recipients] of groupedRecipients) {
      const mxRecords = sortMxRecordsByPriority(await deps.resolveMxFn(domain));
      if (mxRecords.length === 0) {
        throw new Error(`No MX records found for domain ${domain}`);
      }

      let delivered = false;
      let lastError: Error | null = null;

      for (const mx of mxRecords) {
        try {
          await deps.relayFn(mx.exchange, {
            from: job.data.from,
            to: recipients,
            message: signedMime,
            ehloDomain: `mail.${deps.smtpDomain}`,
          });
          delivered = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }

      if (!delivered) {
        throw lastError ?? new Error(`Failed to relay message for ${domain}`);
      }
    }

    await deps.dataStore.markDelivered(job.data.encryptedBodyRef, deps.nowIsoFn());
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const maxAttempts = job.opts.attempts ?? 5;
    const currentAttempt = job.attemptsMade + 1;
    const isDead = currentAttempt >= maxAttempts;

    await deps.dataStore.markFailed(job.data.encryptedBodyRef, errorMessage, isDead);

    if (isDead) {
      await deps.deadLetterQueue.add('dead-outbound-mail', {
        originalQueue: QUEUE_NAMES.OUTBOUND_MAIL,
        originalJobId: String(job.id ?? ''),
        failureReason: errorMessage,
        failedAt: deps.nowIsoFn(),
        originalData: job.data,
      });

      await deps.dataStore.createBounceNotification(job.data, errorMessage);
    }

    throw error;
  } finally {
    mimeBody = undefined;
  }
}

export function startOutboundWorker(
  overrides: Partial<OutboundWorkerDeps> = {},
): Worker<OutboundMailJob> {
  const deps = createDefaultDeps(overrides);

  return new BullWorker<OutboundMailJob>(
    QUEUE_NAMES.OUTBOUND_MAIL,
    async (job: Job<OutboundMailJob>) => {
      await processOutboundMailJob(
        {
          ...(job.id === undefined ? {} : { id: job.id }),
          data: job.data,
          attemptsMade: job.attemptsMade,
          opts: job.opts.attempts === undefined ? {} : { attempts: job.opts.attempts },
        },
        deps,
      );
    },
    {
      connection: createRedisConnection(),
      settings: {
        backoffStrategy: (attemptsMade: number, type?: string): number => {
          if (type === 'outbound-mail-backoff') {
            return outboundBackoffDelay(attemptsMade);
          }

          return 0;
        },
      },
    },
  );
}
