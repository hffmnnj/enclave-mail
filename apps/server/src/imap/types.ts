export const IMAP_CAPABILITY = 'IMAP4rev1 IDLE UIDPLUS';

export type ImapConnectionState = 'NOT_AUTHENTICATED' | 'AUTHENTICATED' | 'SELECTED' | 'LOGOUT';

export type ImapStatus = 'OK' | 'NO' | 'BAD';

export interface ImapSession {
  state: ImapConnectionState;
  userId: string | null;
  selectedMailbox: string | null;
  isIdling?: boolean;
  idleTag?: string | undefined;
  idleUnsubscribe?: (() => void) | undefined;
  idleTimer?: ReturnType<typeof setTimeout> | undefined;
}

export interface ImapCommand {
  tag: string;
  command: string;
  args: string[];
  raw: string;
}

export interface ImapAuthResult {
  userId: string;
}

export type ValidateImapLoginFn = (
  email: string,
  sessionToken: string,
) => Promise<ImapAuthResult | null>;

export interface ImapCommandResult {
  responses: Array<string | Uint8Array>;
  closeConnection: boolean;
}

export interface ImapSessionProcessor {
  readonly session: ImapSession;
  onOpen: () => string[];
  onLine: (line: string) => Promise<ImapCommandResult>;
  onClose: () => void;
}

export interface ImapLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface StartImapServerOptions {
  host?: string;
  port?: number;
  certPath?: string;
  keyPath?: string;
  logger?: ImapLogger;
  validateLogin?: ValidateImapLoginFn;
  listen?: typeof Bun.listen;
}

export interface ImapServerHandle {
  started: boolean;
  host: string;
  port: number;
  reason?: 'missing_tls_config' | 'listen_failed';
  stop: () => void;
}
