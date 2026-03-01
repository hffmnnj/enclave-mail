/**
 * UnverifiedBanner
 *
 * Displays a dismissible amber banner when the current user's email is not
 * verified and email verification is required. Includes a "Resend" button
 * that calls POST /auth/resend-verification.
 *
 * The banner fetches the user's verification status from GET /auth/me on
 * mount. It re-appears on every page load until the email is verified.
 */
import * as React from 'react';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const getApiBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) {
    return import.meta.env.PUBLIC_API_URL as string;
  }
  return 'http://localhost:3001';
};

const getSessionToken = (): string | null =>
  typeof window !== 'undefined' ? localStorage.getItem('enclave:sessionToken') : null;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UnverifiedBanner = (): React.ReactElement | null => {
  const [visible, setVisible] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [resendMessage, setResendMessage] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const token = getSessionToken();
    if (!token) return;

    const checkVerification = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) return;

        const data = (await res.json()) as {
          emailVerified: boolean;
          isAdmin: boolean;
        };

        // Show banner only if not verified (admins can bypass send-block
        // but should still see the banner as a reminder)
        if (!data.emailVerified) {
          setVisible(true);
        }
      } catch {
        // Silently fail — don't block the UI for a status check
      }
    };

    void checkVerification();
  }, []);

  const handleResend = React.useCallback(async () => {
    const token = getSessionToken();
    if (!token) return;

    setResending(true);
    setResendMessage(null);

    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/resend-verification`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.ok) {
        setResendMessage('Verification email sent! Check your inbox.');
      } else {
        setResendMessage('Failed to resend. Please try again later.');
      }
    } catch {
      setResendMessage('Network error. Please try again later.');
    } finally {
      setResending(false);
    }
  }, []);

  if (!visible || dismissed) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-amber-300/30 bg-amber-50 px-4 py-2.5 text-ui-sm text-amber-900 dark:border-amber-700/30 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <span>Please verify your email address. Check your inbox for a verification link.</span>
        {resendMessage && <span className="ml-2 font-medium">{resendMessage}</span>}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="rounded px-2 py-1 text-ui-xs font-medium text-amber-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-amber-300"
        >
          {resending ? 'Sending...' : 'Resend verification email'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-0.5 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
          aria-label="Dismiss"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <title>Dismiss</title>
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export { UnverifiedBanner };
