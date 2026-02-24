import { createIdleCommandHandler } from './commands/idle.js';
import { createMailboxCommandHandler } from './commands/mailbox.js';
import { createMessageCommandHandler } from './commands/message.js';
import type { subscribeMailboxUpdates } from './notify.js';
import { parseImapCommand } from './parser.js';
import {
  IMAP_CAPABILITY,
  type ImapCommand,
  type ImapCommandResult,
  type ImapLogger,
  type ImapServerHandle,
  type ImapSession,
  type ImapSessionProcessor,
  type StartImapServerOptions,
  type ValidateImapLoginFn,
} from './types.js';

const DEFAULT_IMAPS_PORT = 993;
const DEFAULT_IMAPS_HOST = '0.0.0.0';

function toUntagged(response: string): string {
  return `* ${response}\r\n`;
}

function toTagged(tag: string, status: 'OK' | 'NO' | 'BAD', message: string): string {
  return `${tag} ${status} ${message}\r\n`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function validateImapLogin(
  email: string,
  sessionToken: string,
): Promise<{ userId: string } | null> {
  const [{ validateSession }, { db, users }, { eq }] = await Promise.all([
    import('../middleware/session.js'),
    import('@enclave/db'),
    import('drizzle-orm'),
  ]);

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !sessionToken) {
    return null;
  }

  const session = await validateSession(sessionToken);
  if (!session) {
    return null;
  }

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  const user = userRows[0];

  if (!user || user.id !== session.userId) {
    return null;
  }

  return { userId: user.id };
}

function getMissingTlsConfig(certPath: string | undefined, keyPath: string | undefined): string[] {
  const missing: string[] = [];
  if (!certPath) {
    missing.push('TLS_CERT_PATH');
  }
  if (!keyPath) {
    missing.push('TLS_KEY_PATH');
  }
  return missing;
}

async function executeCommand(
  session: ImapSession,
  command: ImapCommand,
  validateLogin: ValidateImapLoginFn,
  mailboxCommandHandler: (session: ImapSession, command: ImapCommand) => Promise<ImapCommandResult>,
  messageCommandHandler: (session: ImapSession, command: ImapCommand) => Promise<ImapCommandResult>,
  idleCommandHandler: ReturnType<typeof createIdleCommandHandler>,
): Promise<ImapCommandResult> {
  const responses: string[] = [];

  if (session.state === 'LOGOUT') {
    responses.push(toTagged(command.tag, 'BAD', 'Session already closed'));
    return { responses, closeConnection: true };
  }

  switch (command.command) {
    case 'CAPABILITY': {
      responses.push(toUntagged(`CAPABILITY ${IMAP_CAPABILITY}`));
      responses.push(toTagged(command.tag, 'OK', 'CAPABILITY completed'));
      return { responses, closeConnection: false };
    }

    case 'NOOP': {
      responses.push(toTagged(command.tag, 'OK', 'NOOP completed'));
      return { responses, closeConnection: false };
    }

    case 'LOGIN': {
      if (session.state !== 'NOT_AUTHENTICATED') {
        responses.push(toTagged(command.tag, 'BAD', 'Already authenticated'));
        return { responses, closeConnection: false };
      }

      const [email, password] = command.args;
      if (!email || !password) {
        responses.push(toTagged(command.tag, 'BAD', 'LOGIN requires username and password'));
        return { responses, closeConnection: false };
      }

      const authResult = await validateLogin(email, password);
      if (!authResult) {
        responses.push(toTagged(command.tag, 'NO', 'LOGIN failed'));
        return { responses, closeConnection: false };
      }

      session.state = 'AUTHENTICATED';
      session.userId = authResult.userId;
      responses.push(toTagged(command.tag, 'OK', 'LOGIN completed'));
      return { responses, closeConnection: false };
    }

    case 'LOGOUT': {
      idleCommandHandler.cleanup(session);
      session.state = 'LOGOUT';
      responses.push(toUntagged('BYE Enclave IMAP closing'));
      responses.push(toTagged(command.tag, 'OK', 'LOGOUT completed'));
      return { responses, closeConnection: true };
    }

    case 'IDLE': {
      return idleCommandHandler.handleIdle(session, command);
    }

    case 'DONE': {
      return idleCommandHandler.handleDone(session);
    }

    case 'LIST':
    case 'LSUB':
    case 'SELECT':
    case 'EXAMINE':
    case 'CREATE':
    case 'DELETE':
    case 'STATUS':
    case 'CLOSE': {
      return mailboxCommandHandler(session, command);
    }

    case 'FETCH':
    case 'STORE':
    case 'SEARCH':
    case 'COPY':
    case 'EXPUNGE':
    case 'UID':
    case 'APPEND': {
      return messageCommandHandler(session, command);
    }

    default: {
      responses.push(toTagged(command.tag, 'BAD', 'Unsupported command'));
      return { responses, closeConnection: false };
    }
  }
}

export function createImapSessionProcessor(options: {
  validateLogin: ValidateImapLoginFn;
  pushResponse?: (response: string) => void;
  closeConnection?: () => void;
  subscribeUpdates?: typeof subscribeMailboxUpdates;
  idleTimeoutMs?: number;
  setTimer?: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}): ImapSessionProcessor {
  const mailboxCommandHandler = createMailboxCommandHandler();
  const messageCommandHandler = createMessageCommandHandler();
  const idleCommandHandlerOptions = {
    onPushResponse: options.pushResponse ?? (() => undefined),
    onCloseConnection: options.closeConnection ?? (() => undefined),
    ...(options.subscribeUpdates ? { subscribeUpdates: options.subscribeUpdates } : {}),
    ...(options.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
    ...(options.setTimer ? { setTimer: options.setTimer } : {}),
    ...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
  };
  const idleCommandHandler = createIdleCommandHandler(idleCommandHandlerOptions);

  const session: ImapSession = {
    state: 'NOT_AUTHENTICATED',
    userId: null,
    selectedMailbox: null,
    isIdling: false,
  };

  return {
    session,
    onOpen: () => [toUntagged(`OK [CAPABILITY ${IMAP_CAPABILITY}] Enclave IMAP ready`)],
    onLine: async (line: string) => {
      const parsed = parseImapCommand(line);
      if (!parsed) {
        return {
          responses: ['* BAD Invalid command syntax\r\n'],
          closeConnection: false,
        };
      }

      return executeCommand(
        session,
        parsed,
        options.validateLogin,
        mailboxCommandHandler,
        messageCommandHandler,
        idleCommandHandler,
      );
    },
    onClose: () => {
      idleCommandHandler.cleanup(session);
    },
  };
}

interface ImapSocket {
  write(data: string | Uint8Array): number;
  end(): void;
}

interface ConnectionContext {
  buffer: string;
  queue: string[];
  processing: Promise<void>;
  processor: ImapSessionProcessor;
}

function createNoopHandle(
  host: string,
  port: number,
  reason: 'missing_tls_config' | 'listen_failed',
): ImapServerHandle {
  return {
    started: false,
    host,
    port,
    reason,
    stop: () => undefined,
  };
}

export function startIMAPServer(options: StartImapServerOptions = {}): ImapServerHandle {
  const logger: ImapLogger = options.logger ?? console;
  const host = options.host ?? process.env.IMAP_HOST ?? DEFAULT_IMAPS_HOST;
  const port = options.port ?? Number(process.env.IMAP_PORT ?? DEFAULT_IMAPS_PORT);

  const certPath = options.certPath ?? process.env.TLS_CERT_PATH;
  const keyPath = options.keyPath ?? process.env.TLS_KEY_PATH;

  const missingTlsConfig = getMissingTlsConfig(certPath, keyPath);
  if (missingTlsConfig.length > 0) {
    logger.warn(
      `[imap] TLS disabled: missing ${missingTlsConfig.join(', ')}. IMAPS listener not started.`,
    );
    return createNoopHandle(host, port, 'missing_tls_config');
  }

  if (!certPath || !keyPath) {
    return createNoopHandle(host, port, 'missing_tls_config');
  }

  const tlsCertPath = certPath;
  const tlsKeyPath = keyPath;

  const sessions = new Map<ImapSocket, ConnectionContext>();
  const textDecoder = new TextDecoder();
  const validateLogin = options.validateLogin ?? validateImapLogin;

  try {
    const listen = options.listen ?? Bun.listen;

    const listener = listen({
      hostname: host,
      port,
      tls: {
        cert: Bun.file(tlsCertPath),
        key: Bun.file(tlsKeyPath),
      },
      socket: {
        open(socket) {
          const processor = createImapSessionProcessor({
            validateLogin,
            pushResponse: (response) => {
              socket.write(response);
            },
            closeConnection: () => {
              socket.end();
            },
          });
          const context: ConnectionContext = {
            buffer: '',
            queue: [],
            processing: Promise.resolve(),
            processor,
          };

          sessions.set(socket as ImapSocket, context);
          for (const response of processor.onOpen()) {
            socket.write(response);
          }
        },
        data(socket, data) {
          const context = sessions.get(socket as ImapSocket);
          if (!context) {
            return;
          }

          context.buffer += textDecoder.decode(data);

          let separatorIndex = context.buffer.indexOf('\n');
          while (separatorIndex !== -1) {
            const line = context.buffer.slice(0, separatorIndex).replace(/\r$/, '');
            context.buffer = context.buffer.slice(separatorIndex + 1);

            if (line.length > 0) {
              context.queue.push(line);
            }

            separatorIndex = context.buffer.indexOf('\n');
          }

          context.processing = context.processing.then(async () => {
            while (context.queue.length > 0) {
              const line = context.queue.shift();
              if (!line) {
                continue;
              }

              const result = await context.processor.onLine(line);
              for (const response of result.responses) {
                socket.write(response);
              }

              if (result.closeConnection) {
                socket.end();
                break;
              }
            }
          });
        },
        close(socket) {
          const context = sessions.get(socket as ImapSocket);
          context?.processor.onClose();
          sessions.delete(socket as ImapSocket);
        },
        error(_socket, error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`[imap] socket error: ${message}`);
        },
      },
    });

    logger.info(`[imap] IMAPS listening on ${listener.hostname}:${listener.port}`);

    return {
      started: true,
      host: listener.hostname,
      port: listener.port,
      stop: () => {
        listener.stop();
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown listen error';
    logger.warn(`[imap] failed to start IMAPS listener: ${message}`);
    return createNoopHandle(host, port, 'listen_failed');
  }
}
