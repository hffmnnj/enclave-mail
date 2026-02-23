import type { InboundMailJob } from '@enclave/types';

export interface SMTPServerConfig {
  cwd?: string;
  harakaConfigPath?: string;
  smtpDomain?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  redisUrl?: string;
}

export type { InboundMailJob };

export interface HarakaAuthPlugin {
  register(): void;
  shutdown?(): void;
  hook_auth(
    next: (code?: number, message?: string) => void,
    connection: unknown,
    params: unknown[],
  ): void;
}

export interface HarakaQueuePlugin {
  register(): void;
  shutdown?(): void;
  hook_data_post(next: (code?: number, message?: string) => void, connection: unknown): void;
}

export interface HarakaRcptPlugin {
  register(): void;
  shutdown?(): void;
  hook_rcpt(
    next: (code?: number, message?: string) => void,
    connection: unknown,
    params: unknown[],
  ): void;
}
