import { describe, expect, mock, test } from 'bun:test';

import { computeSharedSecret, generateX25519KeyPair } from '@enclave/crypto';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { type InboundEncryptionMetadata, processInboundMailJob } from '../queue/inbound-worker.js';
import { extractMailMetadata, parseRawEmail } from './inbound.js';

const HKDF_INFO = 'enclave-inbound-v1';

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

const SAMPLE_RAW_EMAIL = [
  'From: Alice <alice@example.net>',
  'To: local@example.com',
  'Subject: Hello World',
  'Message-ID: <msg-123@example.net>',
  'Date: Tue, 20 Feb 2026 12:34:56 +0000',
  '',
  'This is a test message.',
].join('\r\n');

describe('inbound parse utilities', () => {
  test('parseRawEmail extracts from/to/subject/messageId', async () => {
    const parsed = await parseRawEmail(SAMPLE_RAW_EMAIL);
    const metadata = extractMailMetadata(parsed);

    expect(metadata.from).toBe('alice@example.net');
    expect(metadata.to).toEqual(['local@example.com']);
    expect(metadata.subject).toBe('Hello World');
    expect(metadata.messageId).toBe('<msg-123@example.net>');
  });

  test('extractMailMetadata returns typed metadata', async () => {
    const parsed = await parseRawEmail(SAMPLE_RAW_EMAIL);
    const metadata = extractMailMetadata(parsed);

    expect(metadata).toEqual({
      from: 'alice@example.net',
      to: ['local@example.com'],
      subject: 'Hello World',
      messageId: '<msg-123@example.net>',
      inReplyTo: null,
      date: new Date('2026-02-20T12:34:56.000Z'),
      size: Buffer.byteLength(SAMPLE_RAW_EMAIL, 'utf8'),
    });
  });
});

describe('inbound worker pipeline', () => {
  test('encrypts full raw email body with recipient public key', async () => {
    const recipientKeyPair = generateX25519KeyPair();

    let storedBody: Buffer | null = null;
    let storedMetadata: InboundEncryptionMetadata | null = null;

    await processInboundMailJob(
      {
        data: {
          rawEmail: SAMPLE_RAW_EMAIL,
          sourceIp: '203.0.113.5',
          tlsInfo: { secured: true, cipher: 'TLS_AES_256_GCM_SHA384' },
        },
      },
      {
        verifyMessageFn: async () => ({
          dkim: 'pass',
          spf: 'pass',
          dmarc: 'pass',
          dmarcPolicy: 'none',
        }),
        dataStore: {
          findUserByEmail: async () => ({ id: 'user-1', email: 'local@example.com' }),
          findActiveX25519PublicKey: async () => recipientKeyPair.publicKey,
          findInboxMailbox: async () => ({ id: 'mailbox-1', uidNext: 1 }),
          storeDelivery: async (input) => {
            storedBody = input.encryptedBody;
            storedMetadata = input.encryptionMetadata;
            return 'stored';
          },
        },
      },
    );

    expect(storedBody).toBeTruthy();
    expect(storedMetadata).toBeTruthy();

    if (!storedMetadata || !storedBody) {
      throw new Error('Expected encrypted payload to be stored');
    }

    const metadata: InboundEncryptionMetadata = storedMetadata;
    const sharedSecret = computeSharedSecret(
      recipientKeyPair.privateKey,
      hexToBytes(metadata.ephemeralPublicKey),
    );
    const key = hkdf(sha256, sharedSecret, new Uint8Array(0), HKDF_INFO, 32);

    const bodyCipher = chacha20poly1305(key, hexToBytes(metadata.bodyNonce));
    const decryptedBody = bodyCipher.decrypt(new Uint8Array(storedBody));

    expect(new TextDecoder().decode(decryptedBody)).toBe(SAMPLE_RAW_EMAIL);
  });

  test('skips unknown recipients gracefully', async () => {
    const warn = mock(() => undefined);
    const storeDelivery = mock(async () => 'stored' as const);

    const result = await processInboundMailJob(
      {
        data: {
          rawEmail: SAMPLE_RAW_EMAIL,
          sourceIp: '203.0.113.5',
          tlsInfo: { secured: true },
        },
      },
      {
        verifyMessageFn: async () => ({
          dkim: 'none',
          spf: 'neutral',
          dmarc: 'none',
          dmarcPolicy: null,
        }),
        dataStore: {
          findUserByEmail: async () => null,
          findActiveX25519PublicKey: async () => null,
          findInboxMailbox: async () => null,
          storeDelivery,
        },
        logger: {
          info: () => undefined,
          warn,
          error: () => undefined,
        },
      },
    );

    expect(result.skippedRecipients).toBe(1);
    expect(result.storedRecipients).toBe(0);
    expect(storeDelivery).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('deduplicates repeated message_id deliveries', async () => {
    const recipientKeyPair = generateX25519KeyPair();
    const deliveredMessageIds = new Set<string>();

    const storeDelivery = mock(async (input) => {
      const dedupeKey = `${input.mailboxId}:${input.messageId}`;
      if (deliveredMessageIds.has(dedupeKey)) {
        return 'duplicate' as const;
      }

      deliveredMessageIds.add(dedupeKey);
      return 'stored' as const;
    });

    const deps = {
      verifyMessageFn: async () => ({
        dkim: 'pass' as const,
        spf: 'pass' as const,
        dmarc: 'pass' as const,
        dmarcPolicy: 'none',
      }),
      dataStore: {
        findUserByEmail: async () => ({ id: 'user-1', email: 'local@example.com' }),
        findActiveX25519PublicKey: async () => recipientKeyPair.publicKey,
        findInboxMailbox: async () => ({ id: 'mailbox-1', uidNext: 1 }),
        storeDelivery,
      },
    };

    const first = await processInboundMailJob(
      {
        data: {
          rawEmail: SAMPLE_RAW_EMAIL,
          sourceIp: '203.0.113.5',
          tlsInfo: { secured: true },
        },
      },
      deps,
    );

    const second = await processInboundMailJob(
      {
        data: {
          rawEmail: SAMPLE_RAW_EMAIL,
          sourceIp: '203.0.113.5',
          tlsInfo: { secured: true },
        },
      },
      deps,
    );

    expect(first.storedRecipients).toBe(1);
    expect(second.duplicateRecipients).toBe(1);
    expect(storeDelivery).toHaveBeenCalledTimes(2);
  });
});
