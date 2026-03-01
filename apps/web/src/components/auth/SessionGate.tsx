/**
 * SessionGate
 *
 * Wraps any React island that requires the in-memory session key. On page
 * refresh the key is lost (it lives only in `window.__enclave_session_key`),
 * so this gate detects the missing key and shows the UnlockPrompt modal to
 * re-derive it from the user's passphrase — the same model Proton Mail uses.
 *
 * States:
 *  - checking  → brief loading state while we inspect window/localStorage
 *  - locked    → session token exists but key is absent → show UnlockPrompt
 *  - unlocked  → key is present → render children
 *  - (redirect → no session token at all → redirect to /login)
 */
import * as React from 'react';

import { UnlockPrompt } from './UnlockPrompt.js';

type GateState = 'checking' | 'locked' | 'unlocked';

interface SessionGateProps {
  children: React.ReactNode;
}

const SessionGate = ({ children }: SessionGateProps): React.ReactElement => {
  const [gateState, setGateState] = React.useState<GateState>('checking');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasSessionKey =
      window.__enclave_session_key instanceof Uint8Array && window.__enclave_session_key.length > 0;

    if (hasSessionKey) {
      setGateState('unlocked');
      return;
    }

    const hasSessionToken = Boolean(localStorage.getItem('enclave:sessionToken'));

    if (hasSessionToken) {
      setGateState('locked');
    } else {
      window.location.href = '/login';
    }
  }, []);

  const handleUnlocked = React.useCallback(() => {
    setGateState('unlocked');
  }, []);

  const handleCancel = React.useCallback(() => {
    try {
      localStorage.removeItem('enclave:sessionToken');
      localStorage.removeItem('enclave:userEmail');
      localStorage.removeItem('enclave:srpSalt');
    } catch {
      // Storage may be unavailable
    }
    window.location.href = '/login';
  }, []);

  if (gateState === 'checking') {
    return (
      <div className="flex items-center justify-center h-full p-8 text-text-secondary">
        <span className="font-mono text-ui-sm">Verifying session…</span>
      </div>
    );
  }

  if (gateState === 'locked') {
    return <UnlockPrompt onUnlocked={handleUnlocked} onCancel={handleCancel} />;
  }

  return <>{children}</>;
};

export { SessionGate };
export type { SessionGateProps };
