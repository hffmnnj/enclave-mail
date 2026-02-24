import { describe, expect, test } from 'bun:test';

import { generateDnsRecords } from './dns-records-service.js';

describe('generateDnsRecords', () => {
  const domain = 'example.com';
  const result = generateDnsRecords(domain);

  test('returns all four record types', () => {
    expect(result).toHaveProperty('mx');
    expect(result).toHaveProperty('spf');
    expect(result).toHaveProperty('dkim');
    expect(result).toHaveProperty('dmarc');
  });

  describe('MX record', () => {
    test('has correct type and label', () => {
      expect(result.mx.type).toBe('MX');
      expect(result.mx.label).toBe('MX Record');
    });

    test('points to mail subdomain of the given domain', () => {
      expect(result.mx.host).toBe('@');
      expect(result.mx.value).toBe('mail.example.com');
      expect(result.mx.priority).toBe(10);
    });
  });

  describe('SPF record', () => {
    test('has correct type and label', () => {
      expect(result.spf.type).toBe('TXT');
      expect(result.spf.label).toBe('SPF Record');
    });

    test('uses mx soft-fail policy', () => {
      expect(result.spf.host).toBe('@');
      expect(result.spf.value).toBe('v=spf1 mx ~all');
    });

    test('has no priority', () => {
      expect(result.spf.priority).toBeUndefined();
    });
  });

  describe('DKIM record', () => {
    test('has correct type and label', () => {
      expect(result.dkim.type).toBe('TXT');
      expect(result.dkim.label).toBe('DKIM Record');
    });

    test('uses mail._domainkey selector', () => {
      expect(result.dkim.host).toBe('mail._domainkey');
    });

    test('contains DKIM version and placeholder public key', () => {
      expect(result.dkim.value).toContain('v=DKIM1');
      expect(result.dkim.value).toContain('k=rsa');
      expect(result.dkim.value).toContain('<DKIM_PUBLIC_KEY_PLACEHOLDER>');
    });
  });

  describe('DMARC record', () => {
    test('has correct type and label', () => {
      expect(result.dmarc.type).toBe('TXT');
      expect(result.dmarc.label).toBe('DMARC Record');
    });

    test('uses _dmarc host with none policy', () => {
      expect(result.dmarc.host).toBe('_dmarc');
      expect(result.dmarc.value).toContain('v=DMARC1');
      expect(result.dmarc.value).toContain('p=none');
    });

    test('includes postmaster rua address for the given domain', () => {
      expect(result.dmarc.value).toContain('rua=mailto:postmaster@example.com');
    });
  });

  describe('domain interpolation', () => {
    test('correctly interpolates a different domain', () => {
      const custom = generateDnsRecords('mymail.org');

      expect(custom.mx.value).toBe('mail.mymail.org');
      expect(custom.dmarc.value).toContain('postmaster@mymail.org');
    });

    test('handles subdomain input', () => {
      const sub = generateDnsRecords('mail.corp.example.com');

      expect(sub.mx.value).toBe('mail.mail.corp.example.com');
      expect(sub.dmarc.value).toContain('postmaster@mail.corp.example.com');
    });
  });
});
