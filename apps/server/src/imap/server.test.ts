import { describe, expect, mock, test } from 'bun:test';

import { createImapSessionProcessor, startIMAPServer } from './server.js';

class FakeSocket {
  public writes: string[] = [];
  public ended = false;

  write(data: string | Uint8Array): number {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    this.writes.push(text);
    return text.length;
  }

  end(): void {
    this.ended = true;
  }
}

interface CapturedListenConfig {
  socket: {
    open: (socket: FakeSocket) => void;
    data: (socket: FakeSocket, data: Uint8Array) => void;
  };
}

function createListenMock(captured: { config: CapturedListenConfig | null }): typeof Bun.listen {
  return ((config: unknown) => {
    captured.config = config as CapturedListenConfig;

    return {
      hostname: '127.0.0.1',
      port: 993,
      stop: mock(() => undefined),
    } as unknown as ReturnType<typeof Bun.listen>;
  }) as typeof Bun.listen;
}

describe('createImapSessionProcessor', () => {
  test('sends greeting on open', () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
    });

    expect(processor.onOpen()).toEqual([
      '* OK [CAPABILITY IMAP4rev1 IDLE UIDPLUS] Enclave IMAP ready\r\n',
    ]);
    expect(processor.session.state).toBe('NOT_AUTHENTICATED');
  });

  test('returns CAPABILITY response before auth', async () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
    });

    const result = await processor.onLine('A001 CAPABILITY');

    expect(result.closeConnection).toBe(false);
    expect(result.responses).toEqual([
      '* CAPABILITY IMAP4rev1 IDLE UIDPLUS\r\n',
      'A001 OK CAPABILITY completed\r\n',
    ]);
  });

  test('handles LOGIN success with session-token validation', async () => {
    const validateLogin = mock(async (email: string, token: string) => {
      if (email === 'user@example.com' && token === 'valid-token') {
        return { userId: 'user-123' };
      }
      return null;
    });

    const processor = createImapSessionProcessor({ validateLogin });
    const result = await processor.onLine('A002 LOGIN user@example.com valid-token');

    expect(validateLogin).toHaveBeenCalledWith('user@example.com', 'valid-token');
    expect(result.responses).toEqual(['A002 OK LOGIN completed\r\n']);
    expect(processor.session.state).toBe('AUTHENTICATED');
    expect(processor.session.userId).toBe('user-123');
  });

  test('handles LOGIN failure without user enumeration', async () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
    });

    const result = await processor.onLine('A003 LOGIN user@example.com wrong-token');

    expect(result.responses).toEqual(['A003 NO LOGIN failed\r\n']);
    expect(processor.session.state).toBe('NOT_AUTHENTICATED');
  });

  test('handles NOOP command', async () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
    });

    const result = await processor.onLine('A004 NOOP');

    expect(result.responses).toEqual(['A004 OK NOOP completed\r\n']);
    expect(result.closeConnection).toBe(false);
  });

  test('handles LOGOUT command and closes connection', async () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
    });

    const result = await processor.onLine('A005 LOGOUT');

    expect(result.responses).toEqual([
      '* BYE Enclave IMAP closing\r\n',
      'A005 OK LOGOUT completed\r\n',
    ]);
    expect(result.closeConnection).toBe(true);
    expect(processor.session.state).toBe('LOGOUT');
  });

  test('returns BAD for unknown command', async () => {
    const processor = createImapSessionProcessor({
      validateLogin: async () => null,
    });

    const result = await processor.onLine('A006 FOO');

    expect(result.responses).toEqual(['A006 BAD Unsupported command\r\n']);
    expect(result.closeConnection).toBe(false);
  });
});

describe('startIMAPServer', () => {
  test('skips startup when TLS config is missing', () => {
    const logger = {
      info: mock(() => undefined),
      warn: mock(() => undefined),
      error: mock(() => undefined),
    };

    const handle = startIMAPServer({ logger });

    expect(handle.started).toBe(false);
    expect(handle.reason).toBe('missing_tls_config');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('handles open/data flow and writes responses', async () => {
    const captured = { config: null as CapturedListenConfig | null };
    const listenMock = createListenMock(captured);

    const handle = startIMAPServer({
      certPath: '/tmp/cert.pem',
      keyPath: '/tmp/key.pem',
      listen: listenMock,
      validateLogin: async () => null,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    expect(handle.started).toBe(true);
    expect(captured.config).not.toBeNull();

    const socket = new FakeSocket();
    captured.config?.socket.open(socket);
    captured.config?.socket.data(
      socket,
      new TextEncoder().encode('A007 CAPABILITY\r\nA008 LOGOUT\r\n'),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.writes[0]).toBe(
      '* OK [CAPABILITY IMAP4rev1 IDLE UIDPLUS] Enclave IMAP ready\r\n',
    );
    expect(socket.writes).toContain('* CAPABILITY IMAP4rev1 IDLE UIDPLUS\r\n');
    expect(socket.writes).toContain('A007 OK CAPABILITY completed\r\n');
    expect(socket.writes).toContain('* BYE Enclave IMAP closing\r\n');
    expect(socket.writes).toContain('A008 OK LOGOUT completed\r\n');
    expect(socket.ended).toBe(true);
  });
});
