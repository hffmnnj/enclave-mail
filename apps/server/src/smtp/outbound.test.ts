import { describe, expect, mock, test } from 'bun:test';

import type { OutboundMailJob } from '@enclave/types';

import { encryptMimeBody } from '../lib/mime-encryption.js';
import { processOutboundMailJob, sortMxRecordsByPriority } from '../queue/outbound-worker.js';
import { enqueueOutboundMail } from './outbound.js';

const { encryptedMimeBody, mimeBodyNonce } = encryptMimeBody(
  'From: sender@example.com\r\nTo: alice@example.net\r\n\r\nHello world',
);

const BASE_JOB: OutboundMailJob = {
  from: 'sender@example.com',
  to: ['alice@example.net'],
  encryptedBodyRef: 'message-123',
  dkimSign: true,
  encryptedMimeBody,
  mimeBodyNonce,
};

describe('enqueueOutboundMail', () => {
  test('adds a job to outbound queue and returns job id', async () => {
    const queueAdd = mock(async () => ({ id: 'job-42' }));

    const jobId = await enqueueOutboundMail(BASE_JOB, {
      queue: {
        add: queueAdd,
      },
    });

    expect(jobId).toBe('job-42');
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledWith(
      'relay-outbound-mail',
      BASE_JOB,
      expect.objectContaining({
        attempts: 5,
      }),
    );
  });
});

describe('processOutboundMailJob', () => {
  test('processes outbound mail successfully', async () => {
    const loadMessageById = mock(async () => ({
      messageId: 'message-123',
      fromAddress: 'sender@example.com',
      toAddresses: ['alice@example.net'],
      date: new Date('2026-02-23T00:00:00.000Z'),
      subjectEncrypted: Buffer.from('Test subject', 'utf8'),
      encryptedBody: Buffer.from('Encrypted body bytes', 'utf8'),
      contentType: 'text/plain; charset=utf-8',
    }));
    const markDelivered = mock(async () => undefined);
    const markFailed = mock(async () => undefined);
    const createBounceNotification = mock(async () => undefined);

    const resolveMxFn = mock(async () => [
      { exchange: 'mx20.example.net', priority: 20 },
      { exchange: 'mx10.example.net', priority: 10 },
    ]);
    const relayFn = mock(async () => undefined);
    const deadLetterAdd = mock(async () => undefined);

    await processOutboundMailJob(
      {
        id: 'job-1',
        data: BASE_JOB,
        attemptsMade: 0,
        opts: { attempts: 5 },
      },
      {
        dataStore: {
          loadMessageById,
          markDelivered,
          markFailed,
          createBounceNotification,
        },
        resolveMxFn,
        relayFn,
        loadDkimPrivateKeyFn: async () => 'private-key',
        signMessageFn: async (rawMime) => `signed:${rawMime}`,
        deadLetterQueue: {
          add: deadLetterAdd,
        },
        smtpDomain: 'example.com',
        dkimSelector: 'mail',
        nowIsoFn: () => '2026-02-23T00:00:00.000Z',
      },
    );

    expect(resolveMxFn).toHaveBeenCalledWith('example.net');
    expect(relayFn).toHaveBeenCalledTimes(1);
    expect(relayFn).toHaveBeenCalledWith('mx10.example.net', expect.any(Object));
    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledTimes(0);
    expect(deadLetterAdd).toHaveBeenCalledTimes(0);
  });

  test('retries on transient relay failure', async () => {
    const markFailed = mock(async () => undefined);
    const deadLetterAdd = mock(async () => undefined);

    await expect(
      processOutboundMailJob(
        {
          id: 'job-2',
          data: BASE_JOB,
          attemptsMade: 0,
          opts: { attempts: 5 },
        },
        {
          dataStore: {
            loadMessageById: async () => ({
              messageId: 'message-123',
              fromAddress: 'sender@example.com',
              toAddresses: ['alice@example.net'],
              date: new Date('2026-02-23T00:00:00.000Z'),
              subjectEncrypted: Buffer.from('Test subject', 'utf8'),
              encryptedBody: Buffer.from('Encrypted body bytes', 'utf8'),
              contentType: 'text/plain',
            }),
            markDelivered: async () => undefined,
            markFailed,
            createBounceNotification: async () => undefined,
          },
          resolveMxFn: async () => [{ exchange: 'mx10.example.net', priority: 10 }],
          relayFn: async () => {
            throw new Error('ECONNREFUSED');
          },
          loadDkimPrivateKeyFn: async () => 'private-key',
          signMessageFn: async (rawMime) => `signed:${rawMime}`,
          deadLetterQueue: {
            add: deadLetterAdd,
          },
          smtpDomain: 'example.com',
          dkimSelector: 'mail',
          nowIsoFn: () => '2026-02-23T00:00:00.000Z',
        },
      ),
    ).rejects.toThrow('ECONNREFUSED');

    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledWith('message-123', expect.any(String), false);
    expect(deadLetterAdd).toHaveBeenCalledTimes(0);
  });

  test('moves outbound mail to dead-letter after max retries', async () => {
    const markFailed = mock(async () => undefined);
    const createBounceNotification = mock(async () => undefined);
    const deadLetterAdd = mock(async () => undefined);

    await expect(
      processOutboundMailJob(
        {
          id: 'job-3',
          data: BASE_JOB,
          attemptsMade: 4,
          opts: { attempts: 5 },
        },
        {
          dataStore: {
            loadMessageById: async () => ({
              messageId: 'message-123',
              fromAddress: 'sender@example.com',
              toAddresses: ['alice@example.net'],
              date: new Date('2026-02-23T00:00:00.000Z'),
              subjectEncrypted: Buffer.from('Test subject', 'utf8'),
              encryptedBody: Buffer.from('Encrypted body bytes', 'utf8'),
              contentType: 'text/plain',
            }),
            markDelivered: async () => undefined,
            markFailed,
            createBounceNotification,
          },
          resolveMxFn: async () => [{ exchange: 'mx10.example.net', priority: 10 }],
          relayFn: async () => {
            throw new Error('Permanent failure');
          },
          loadDkimPrivateKeyFn: async () => 'private-key',
          signMessageFn: async (rawMime) => `signed:${rawMime}`,
          deadLetterQueue: {
            add: deadLetterAdd,
          },
          smtpDomain: 'example.com',
          dkimSelector: 'mail',
          nowIsoFn: () => '2026-02-23T00:00:00.000Z',
        },
      ),
    ).rejects.toThrow('Permanent failure');

    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledWith('message-123', expect.any(String), true);
    expect(deadLetterAdd).toHaveBeenCalledTimes(1);
    expect(createBounceNotification).toHaveBeenCalledTimes(1);
  });
});

describe('MX priority sorting', () => {
  test('sorts by ascending priority (lower number first)', () => {
    const sorted = sortMxRecordsByPriority([
      { exchange: 'mx30.example.net', priority: 30 },
      { exchange: 'mx10.example.net', priority: 10 },
      { exchange: 'mx20.example.net', priority: 20 },
    ]);

    expect(sorted.map((mx) => mx.exchange)).toEqual([
      'mx10.example.net',
      'mx20.example.net',
      'mx30.example.net',
    ]);
  });
});
