import { describe, expect, test } from 'bun:test';

import { createTlsService } from './tls-service.js';

describe('createTlsService', () => {
  test('triggers certbot successfully', async () => {
    const calls: Array<{ cmd: string[]; timeout: number }> = [];
    const tls = createTlsService({
      spawnFn: async (cmd, opts) => {
        calls.push({ cmd, timeout: opts.timeout });
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });

    const result = await tls.triggerCertbot('example.com');

    expect(result).toEqual({
      success: true,
      message: 'Certificate provisioned successfully',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.timeout).toBe(60_000);
    expect(calls[0]?.cmd).toEqual([
      'certbot',
      'certonly',
      '--standalone',
      '--non-interactive',
      '--agree-tos',
      '--email',
      'postmaster@example.com',
      '-d',
      'example.com',
      '-d',
      'mail.example.com',
    ]);
  });

  test('returns structured failure when certbot exits non-zero', async () => {
    const tls = createTlsService({
      spawnFn: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'certbot: failed challenge',
      }),
    });

    const result = await tls.triggerCertbot('example.com');

    expect(result).toEqual({
      success: false,
      message: 'Certbot failed',
      output: 'certbot: failed challenge',
    });
  });

  test('returns certificate status with certPath when certificate exists', async () => {
    const tls = createTlsService({
      certExistsFn: async () => true,
    });

    const result = await tls.getCertificateStatus('example.com');

    expect(result).toEqual({
      hasCertificate: true,
      domain: 'example.com',
      certPath: '/etc/letsencrypt/live/example.com/fullchain.pem',
    });
  });

  test('returns no certificate status when certificate is missing', async () => {
    const tls = createTlsService({
      certExistsFn: async () => false,
    });

    const result = await tls.getCertificateStatus('example.com');

    expect(result).toEqual({
      hasCertificate: false,
      domain: 'example.com',
    });
  });
});
