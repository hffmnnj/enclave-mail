import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { SMTPServerConfig } from './types.js';

export type BunSubprocess = ReturnType<typeof Bun.spawn>;

interface StartSMTPServerOptions extends SMTPServerConfig {
  spawn?: typeof Bun.spawn;
  logger?: Pick<typeof console, 'info' | 'error'>;
}

const DEFAULT_TLS_CERT_PATH = '/etc/caddy/certs/tls.crt';
const DEFAULT_TLS_KEY_PATH = '/etc/caddy/certs/tls.key';
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

function getDefaultConfig(cwd: string): Required<SMTPServerConfig> {
  return {
    cwd,
    harakaConfigPath: resolve(cwd, 'haraka'),
    smtpDomain: process.env.SMTP_DOMAIN ?? 'localhost',
    tlsCertPath: process.env.TLS_CERT_PATH ?? DEFAULT_TLS_CERT_PATH,
    tlsKeyPath: process.env.TLS_KEY_PATH ?? DEFAULT_TLS_KEY_PATH,
    redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
  };
}

function writeHarakaRuntimeConfig(config: Required<SMTPServerConfig>): void {
  const hostListPath = join(config.harakaConfigPath, 'config', 'host_list');
  const tlsIniPath = join(config.harakaConfigPath, 'config', 'tls.ini');

  mkdirSync(dirname(hostListPath), { recursive: true });

  writeFileSync(hostListPath, `${config.smtpDomain}\n`, 'utf8');
  writeFileSync(
    tlsIniPath,
    `[main]\nkey=${config.tlsKeyPath}\ncert=${config.tlsCertPath}\n`,
    'utf8',
  );
}

function pipeSubprocessStream(
  stream: ReadableStream<Uint8Array> | null,
  log: (message: string) => void,
): void {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  void (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        const chunk = decoder.decode(value, { stream: true }).trim();
        if (chunk) {
          log(chunk);
        }
      }
    }
  })();
}

export function startSMTPServer(options: StartSMTPServerOptions = {}): BunSubprocess {
  const logger = options.logger ?? console;
  const cwd = options.cwd ?? process.cwd();
  const defaults = getDefaultConfig(cwd);

  const config: Required<SMTPServerConfig> = {
    ...defaults,
    ...options,
    cwd: options.cwd ?? defaults.cwd,
    harakaConfigPath: options.harakaConfigPath
      ? resolve(cwd, options.harakaConfigPath)
      : defaults.harakaConfigPath,
  };

  try {
    writeHarakaRuntimeConfig(config);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown config error';
    logger.error(`[smtp] failed to write Haraka runtime config: ${message}`);
  }

  const subprocess = (options.spawn ?? Bun.spawn)(['bunx', 'haraka', '-c', './haraka'], {
    cwd: config.cwd,
    env: {
      ...process.env,
      SMTP_DOMAIN: config.smtpDomain,
      TLS_CERT_PATH: config.tlsCertPath,
      TLS_KEY_PATH: config.tlsKeyPath,
      REDIS_URL: config.redisUrl,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  pipeSubprocessStream(subprocess.stdout, (message) => logger.info(`[haraka] ${message}`));
  pipeSubprocessStream(subprocess.stderr, (message) => logger.error(`[haraka] ${message}`));

  return subprocess;
}
