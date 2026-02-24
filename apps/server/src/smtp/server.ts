import { execSync } from 'node:child_process';
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
// Production defaults — overridden by SMTP_PORT_INBOUND / SMTP_PORT_SUBMISSION in dev
const DEFAULT_SMTP_PORT_INBOUND = 25;
const DEFAULT_SMTP_PORT_SUBMISSION = 587;

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
  const smtpIniPath = join(config.harakaConfigPath, 'config', 'smtp.ini');

  mkdirSync(dirname(hostListPath), { recursive: true });

  writeFileSync(hostListPath, `${config.smtpDomain}\n`, 'utf8');
  writeFileSync(
    tlsIniPath,
    `[main]\nkey=${config.tlsKeyPath}\ncert=${config.tlsCertPath}\n`,
    'utf8',
  );

  // Overwrite listen ports so Haraka binds to the env-configured ports at
  // runtime. Defaults to 25/587 for production; dev uses 2025/2587 (no root).
  const portInbound = Number(process.env.SMTP_PORT_INBOUND) || DEFAULT_SMTP_PORT_INBOUND;
  const portSubmission = Number(process.env.SMTP_PORT_SUBMISSION) || DEFAULT_SMTP_PORT_SUBMISSION;

  // Read current smtp.ini and replace only the listen line so other settings
  // (nodes, timeouts, etc.) are preserved.
  try {
    const { readFileSync } = require('node:fs');
    const current = readFileSync(smtpIniPath, 'utf8') as string;
    const updated = current.replace(
      /^listen=.*/m,
      `listen=[::0]:${portInbound},[::0]:${portSubmission}`,
    );
    writeFileSync(smtpIniPath, updated, 'utf8');
  } catch {
    // smtp.ini not found — skip (Haraka will use its own defaults)
  }
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

function freeSMTPPorts(logger: Pick<typeof console, 'info' | 'error'>): void {
  // In dev, hot-reloads leave stale Haraka child processes holding the SMTP
  // ports. Kill any process currently bound to those ports before spawning.
  const smtpIniPath = resolve(process.cwd(), 'haraka', 'config', 'smtp.ini');
  const ports: number[] = [];

  try {
    const ini = require('node:fs').readFileSync(smtpIniPath, 'utf8') as string;
    const listenLine = ini.split('\n').find((l: string) => l.startsWith('listen='));
    if (listenLine) {
      for (const match of listenLine.matchAll(/:(\d+)/g)) {
        ports.push(Number(match[1]));
      }
    }
  } catch {
    // smtp.ini not readable — skip
  }

  for (const port of ports) {
    try {
      execSync(`fuser -k ${port}/tcp 2>/dev/null`, { stdio: 'ignore' });
      logger.info(`[smtp] freed port ${port}`);
    } catch {
      // nothing was holding the port — that's fine
    }
  }
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

  // Kill any stale Haraka processes from a previous hot-reload before spawning.
  freeSMTPPorts(logger);

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
