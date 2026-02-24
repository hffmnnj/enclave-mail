import { describe, expect, it } from 'bun:test';
import type dns from 'node:dns';
import { createDnsCheckService } from './dns-check-service.js';

const DOMAIN = 'example.com';

const createMockResolveMx =
  (records: dns.MxRecord[]) =>
  async (_hostname: string): Promise<dns.MxRecord[]> =>
    records;

const createMockResolveTxt =
  (mapping: Record<string, string[][]>) =>
  async (hostname: string): Promise<string[][]> => {
    const result = mapping[hostname];
    if (!result) {
      const err = new Error(`queryTxt ENODATA ${hostname}`) as NodeJS.ErrnoException;
      err.code = 'ENODATA';
      throw err;
    }
    return result;
  };

describe('dns-check-service', () => {
  describe('all records pass', () => {
    it('returns pass for all records when DNS is correctly configured', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([{ exchange: `mail.${DOMAIN}`, priority: 10 }]),
        resolveTxt: createMockResolveTxt({
          [DOMAIN]: [['v=spf1 mx ~all']],
          [`mail._domainkey.${DOMAIN}`]: [['v=DKIM1; k=rsa; p=TESTKEY']],
          [`_dmarc.${DOMAIN}`]: [['v=DMARC1; p=none; rua=mailto:postmaster@example.com']],
        }),
      });

      const result = await service.checkDns(DOMAIN);

      expect(result.mx).toBe('pass');
      expect(result.spf).toBe('pass');
      expect(result.dkim).toBe('pass');
      expect(result.dmarc).toBe('pass');
      expect(result.allPassed).toBe(true);
    });
  });

  describe('MX record checks', () => {
    it('returns pass when MX exchange matches mail.{domain}', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([{ exchange: `mail.${DOMAIN}`, priority: 10 }]),
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('pass');
    });

    it('returns pass when MX exchange has trailing dot', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([{ exchange: `mail.${DOMAIN}.`, priority: 10 }]),
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('pass');
    });

    it('returns fail when MX points to wrong host', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([{ exchange: 'other-server.example.com', priority: 10 }]),
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('fail');
    });

    it('returns fail when MX returns empty array', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('fail');
    });

    it('returns not-found when MX lookup throws ENODATA', async () => {
      const service = createDnsCheckService({
        resolveMx: async () => {
          const err = new Error('queryMx ENODATA') as NodeJS.ErrnoException;
          err.code = 'ENODATA';
          throw err;
        },
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('not-found');
    });

    it('returns not-found when MX lookup throws ENOTFOUND', async () => {
      const service = createDnsCheckService({
        resolveMx: async () => {
          const err = new Error('queryMx ENOTFOUND') as NodeJS.ErrnoException;
          err.code = 'ENOTFOUND';
          throw err;
        },
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('not-found');
    });
  });

  describe('SPF record checks', () => {
    it('returns pass when TXT record contains v=spf1', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({
          [DOMAIN]: [['v=spf1 mx ~all']],
        }),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.spf).toBe('pass');
    });

    it('returns pass when SPF is split across TXT chunks', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({
          [DOMAIN]: [['v=spf1 ', 'mx ~all']],
        }),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.spf).toBe('pass');
    });

    it('returns fail when no TXT record contains v=spf1', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({
          [DOMAIN]: [['some-other-txt-record']],
        }),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.spf).toBe('fail');
    });

    it('returns not-found when SPF lookup throws ENODATA', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.spf).toBe('not-found');
    });
  });

  describe('DKIM record checks', () => {
    it('returns pass when DKIM TXT record contains v=DKIM1', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({
          [`mail._domainkey.${DOMAIN}`]: [['v=DKIM1; k=rsa; p=TESTKEY']],
        }),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.dkim).toBe('pass');
    });

    it('returns not-found when DKIM selector has no TXT record', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.dkim).toBe('not-found');
    });
  });

  describe('DMARC record checks', () => {
    it('returns pass when DMARC TXT record contains v=DMARC1', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({
          [`_dmarc.${DOMAIN}`]: [['v=DMARC1; p=none; rua=mailto:postmaster@example.com']],
        }),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.dmarc).toBe('pass');
    });

    it('returns not-found when DMARC has no TXT record', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({}),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.dmarc).toBe('not-found');
    });
  });

  describe('allPassed flag', () => {
    it('returns false when any record is not pass', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([{ exchange: `mail.${DOMAIN}`, priority: 10 }]),
        resolveTxt: createMockResolveTxt({
          [DOMAIN]: [['v=spf1 mx ~all']],
          [`_dmarc.${DOMAIN}`]: [['v=DMARC1; p=none']],
          // DKIM missing → not-found
        }),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('pass');
      expect(result.spf).toBe('pass');
      expect(result.dkim).toBe('not-found');
      expect(result.dmarc).toBe('pass');
      expect(result.allPassed).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('returns not-found when DNS lookup exceeds timeout', async () => {
      const service = createDnsCheckService({
        resolveMx: async () =>
          new Promise((resolve) => {
            setTimeout(() => resolve([{ exchange: `mail.${DOMAIN}`, priority: 10 }]), 500);
          }),
        resolveTxt: async () =>
          new Promise((resolve) => {
            setTimeout(() => resolve([['v=spf1 mx ~all']]), 500);
          }),
        timeoutMs: 50,
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('not-found');
      expect(result.spf).toBe('not-found');
      expect(result.dkim).toBe('not-found');
      expect(result.dmarc).toBe('not-found');
      expect(result.allPassed).toBe(false);
    });
  });

  describe('ESERVFAIL handling', () => {
    it('returns not-found when DNS lookup throws ESERVFAIL', async () => {
      const service = createDnsCheckService({
        resolveMx: async () => {
          const err = new Error('queryMx ESERVFAIL') as NodeJS.ErrnoException;
          err.code = 'ESERVFAIL';
          throw err;
        },
        resolveTxt: async () => {
          const err = new Error('queryTxt ESERVFAIL') as NodeJS.ErrnoException;
          err.code = 'ESERVFAIL';
          throw err;
        },
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('not-found');
      expect(result.spf).toBe('not-found');
      expect(result.dkim).toBe('not-found');
      expect(result.dmarc).toBe('not-found');
    });
  });

  describe('unexpected errors', () => {
    it('returns fail for unexpected non-DNS errors', async () => {
      const service = createDnsCheckService({
        resolveMx: async () => {
          throw new Error('Unexpected network failure');
        },
        resolveTxt: async () => {
          throw new Error('Unexpected network failure');
        },
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.mx).toBe('fail');
      expect(result.spf).toBe('fail');
      expect(result.dkim).toBe('fail');
      expect(result.dmarc).toBe('fail');
      expect(result.allPassed).toBe(false);
    });
  });

  describe('multiple TXT records', () => {
    it('finds SPF among multiple TXT records', async () => {
      const service = createDnsCheckService({
        resolveMx: createMockResolveMx([]),
        resolveTxt: createMockResolveTxt({
          [DOMAIN]: [
            ['google-site-verification=abc123'],
            ['v=spf1 mx ~all'],
            ['some-other-record'],
          ],
        }),
      });

      const result = await service.checkDns(DOMAIN);
      expect(result.spf).toBe('pass');
    });
  });
});
