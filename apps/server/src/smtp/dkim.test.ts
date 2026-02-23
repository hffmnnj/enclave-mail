import { createPrivateKey, createPublicKey } from 'node:crypto';

import { afterEach, describe, expect, test } from 'bun:test';

import { generateDkimKeyPair, signMessage } from './dkim.js';
import { verifyMessage } from './verification.js';

const ORIGINAL_DNS_RECORDS = process.env.MAILAUTH_DNS_RECORDS_JSON;

const BASE_EMAIL = [
  'From: Sender <sender@example.test>',
  'To: Recipient <recipient@example.net>',
  'Subject: DKIM Test Message',
  'Date: Tue, 24 Feb 2026 00:00:00 +0000',
  'Message-ID: <test-message-id@example.test>',
  'Return-Path: <sender@example.test>',
  '',
  'Hello from Enclave Mail!',
  '',
].join('\r\n');

afterEach(() => {
  if (ORIGINAL_DNS_RECORDS === undefined) {
    process.env.MAILAUTH_DNS_RECORDS_JSON = undefined;
    return;
  }

  process.env.MAILAUTH_DNS_RECORDS_JSON = ORIGINAL_DNS_RECORDS;
});

describe('DKIM key generation', () => {
  test('generateDkimKeyPair creates valid RSA 2048-bit keys', async () => {
    const { privateKeyPem, publicKeyPem, dnsRecord } = await generateDkimKeyPair();

    const privateKey = createPrivateKey(privateKeyPem);
    const publicKey = createPublicKey(publicKeyPem);

    expect(privateKey.asymmetricKeyType).toBe('rsa');
    expect(publicKey.asymmetricKeyType).toBe('rsa');
    expect(privateKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(dnsRecord.startsWith('v=DKIM1; k=rsa; p=')).toBeTrue();
  });
});

describe('DKIM signing', () => {
  test('signMessage includes DKIM-Signature header', async () => {
    const { privateKeyPem } = await generateDkimKeyPair();
    const signed = await signMessage(BASE_EMAIL, 'example.test', 'mail', privateKeyPem);

    expect(signed.includes('DKIM-Signature:')).toBeTrue();
  });
});

describe('mailauth verification', () => {
  test('verifyMessage returns dkim pass for self-signed message', async () => {
    const domain = 'example.test';
    const selector = 'mail';
    const { privateKeyPem, dnsRecord } = await generateDkimKeyPair();

    process.env.MAILAUTH_DNS_RECORDS_JSON = JSON.stringify({
      [`${selector}._domainkey.${domain}`]: dnsRecord,
    });

    const signed = await signMessage(BASE_EMAIL, domain, selector, privateKeyPem);
    const result = await verifyMessage(signed, '127.0.0.1');

    expect(result.dkim).toBe('pass');
  });

  test('verifyMessage returns dkim none for unsigned message', async () => {
    process.env.MAILAUTH_DNS_RECORDS_JSON = undefined;

    const result = await verifyMessage(BASE_EMAIL, '127.0.0.1');

    expect(result.dkim).toBe('none');
  });
});
