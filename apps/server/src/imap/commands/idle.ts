import { subscribeMailboxUpdates } from '../notify.js';
import type { ImapCommand, ImapCommandResult, ImapSession } from '../types.js';

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type IdleUpdateSubscriber = (mailboxId: string, callback: (count: number) => void) => () => void;

type IdleTimerHandle = ReturnType<typeof setTimeout>;

type StartIdleOptions = {
  onPushResponse: (response: string) => void;
  onCloseConnection: () => void;
  subscribeUpdates?: IdleUpdateSubscriber;
  idleTimeoutMs?: number;
  setTimer?: (callback: () => void, timeoutMs: number) => IdleTimerHandle;
  clearTimer?: (handle: IdleTimerHandle) => void;
};

type IdleCommandHandler = {
  handleIdle: (session: ImapSession, command: ImapCommand) => ImapCommandResult;
  handleDone: (session: ImapSession) => ImapCommandResult;
  cleanup: (session: ImapSession) => void;
};

function toTagged(tag: string, status: 'OK' | 'NO' | 'BAD', message: string): string {
  return `${tag} ${status} ${message}\r\n`;
}

function clearIdleState(session: ImapSession, clearTimer: (handle: IdleTimerHandle) => void): void {
  if (session.idleUnsubscribe) {
    session.idleUnsubscribe();
  }

  if (session.idleTimer) {
    clearTimer(session.idleTimer);
  }

  session.isIdling = false;
  session.idleTag = undefined;
  session.idleUnsubscribe = undefined;
  session.idleTimer = undefined;
}

export function createIdleCommandHandler(options: StartIdleOptions): IdleCommandHandler {
  const subscribeUpdates = options.subscribeUpdates ?? subscribeMailboxUpdates;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((callback, timeoutMs) => setTimeout(callback, timeoutMs));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));

  const handleIdle = (session: ImapSession, command: ImapCommand): ImapCommandResult => {
    const responses: string[] = [];

    if (session.state !== 'SELECTED' || !session.selectedMailbox) {
      responses.push(toTagged(command.tag, 'BAD', 'Not in selected state'));
      return { responses, closeConnection: false };
    }

    if (session.isIdling) {
      responses.push(toTagged(command.tag, 'BAD', 'Already idling'));
      return { responses, closeConnection: false };
    }

    session.isIdling = true;
    session.idleTag = command.tag;
    session.idleUnsubscribe = subscribeUpdates(session.selectedMailbox, (messageCount: number) => {
      options.onPushResponse(`* ${messageCount} EXISTS\r\n`);
    });
    session.idleTimer = setTimer(() => {
      clearIdleState(session, clearTimer);
      options.onPushResponse('* BYE IDLE timeout\r\n');
      options.onCloseConnection();
    }, idleTimeoutMs);

    responses.push('+ idling\r\n');
    return { responses, closeConnection: false };
  };

  const handleDone = (session: ImapSession): ImapCommandResult => {
    const responses: string[] = [];

    if (!session.isIdling || !session.idleTag) {
      responses.push('BAD Not idling\r\n');
      return { responses, closeConnection: false };
    }

    const tag = session.idleTag;
    clearIdleState(session, clearTimer);
    responses.push(toTagged(tag, 'OK', 'IDLE terminated'));
    return { responses, closeConnection: false };
  };

  return {
    handleIdle,
    handleDone,
    cleanup: (session: ImapSession) => {
      if (session.isIdling) {
        clearIdleState(session, clearTimer);
      }
    },
  };
}
