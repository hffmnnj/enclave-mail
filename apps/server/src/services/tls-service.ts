export interface TlsTriggerResult {
  success: boolean;
  message: string;
  output?: string;
}

export interface TlsStatusResult {
  hasCertificate: boolean;
  domain: string;
  certPath?: string;
}

export interface TlsServiceDeps {
  spawnFn?: (
    cmd: string[],
    opts: { timeout: number },
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  certExistsFn?: (domain: string) => Promise<boolean>;
}

const CERTBOT_TIMEOUT_MS = 60_000;

const buildCertificatePath = (domain: string): string =>
  `/etc/letsencrypt/live/${domain}/fullchain.pem`;

const createTimeoutError = (): Error => new Error('CERTBOT_TIMEOUT');

const defaultSpawnFn: NonNullable<TlsServiceDeps['spawnFn']> = async (cmd, opts) => {
  const process = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      process.kill();
      reject(createTimeoutError());
    }, opts.timeout);

    process.exited.finally(() => clearTimeout(timeoutId));
  });

  await Promise.race([process.exited, timeoutPromise]);

  const stdout = await new Response(process.stdout).text();
  const stderr = await new Response(process.stderr).text();

  return {
    exitCode: process.exitCode ?? -1,
    stdout,
    stderr,
  };
};

const defaultCertExistsFn: NonNullable<TlsServiceDeps['certExistsFn']> = async (domain) =>
  Bun.file(buildCertificatePath(domain)).exists();

export const createTlsService = (deps: TlsServiceDeps = {}) => {
  const spawnFn = deps.spawnFn ?? defaultSpawnFn;
  const certExistsFn = deps.certExistsFn ?? defaultCertExistsFn;

  return {
    async triggerCertbot(domain: string): Promise<TlsTriggerResult> {
      const certbotCommand = [
        'certbot',
        'certonly',
        '--standalone',
        '--non-interactive',
        '--agree-tos',
        '--email',
        `postmaster@${domain}`,
        '-d',
        domain,
        '-d',
        `mail.${domain}`,
      ];

      try {
        const result = await spawnFn(certbotCommand, {
          timeout: CERTBOT_TIMEOUT_MS,
        });

        if (result.exitCode === 0) {
          return {
            success: true,
            message: 'Certificate provisioned successfully',
          };
        }

        return {
          success: false,
          message: 'Certbot failed',
          output: result.stderr || result.stdout,
        };
      } catch (error) {
        if (error instanceof Error && error.message === 'CERTBOT_TIMEOUT') {
          return {
            success: false,
            message: 'Certbot timed out after 60 seconds',
          };
        }

        return {
          success: false,
          message: 'Certbot failed',
          output: error instanceof Error ? error.message : 'Unknown certbot execution error',
        };
      }
    },

    async getCertificateStatus(domain: string): Promise<TlsStatusResult> {
      const certPath = buildCertificatePath(domain);
      const hasCertificate = await certExistsFn(domain);

      if (hasCertificate) {
        return {
          hasCertificate: true,
          domain,
          certPath,
        };
      }

      return {
        hasCertificate: false,
        domain,
      };
    },
  };
};

export const tlsService = createTlsService();
