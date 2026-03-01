/**
 * MailboxView
 *
 * Thin routing adapter that maps a mailbox type (e.g. "inbox", "sent") to its
 * UUID and delegates to InboxView. Mounted as a React island by the Astro
 * catch-all mail route — wraps with QueryClientProvider for island isolation.
 *
 * Includes a session key gate: if the user has a valid session token but the
 * in-memory session key is absent (e.g. after page refresh), an unlock prompt
 * is shown to re-derive the key from the user's passphrase (Proton Mail model).
 */
import * as React from 'react';

import { QueryClientProvider } from '@tanstack/react-query';

import { useMailboxes } from '../../hooks/use-mailboxes.js';
import { getQueryClient } from '../../lib/query-client.js';
import { SessionGate } from '../auth/SessionGate.js';
import { InboxView } from './InboxView.js';

interface MailboxViewProps {
  /** The mailbox type slug from the URL (e.g. "inbox", "sent", "drafts"). */
  mailboxType: string;
}

// Inner component — requires QueryClientProvider ancestor
const MailboxViewInner = ({ mailboxType }: MailboxViewProps): React.ReactElement => {
  const { data: mailboxes, isLoading, isError } = useMailboxes();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-text-secondary text-ui-base">
        <span className="font-mono text-ui-sm">Loading mailbox…</span>
      </div>
    );
  }

  if (isError || !mailboxes) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-status-error text-ui-base">
        <span className="font-mono text-ui-sm">Failed to load mailboxes.</span>
      </div>
    );
  }

  const mailbox = mailboxes.find(
    (m) => m.type === mailboxType || m.name.toLowerCase() === mailboxType,
  );

  if (!mailbox) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-text-secondary text-ui-base">
        <p className="font-mono text-ui-sm">Mailbox &ldquo;{mailboxType}&rdquo; not found.</p>
      </div>
    );
  }

  return <InboxView mailboxId={mailbox.id} />;
};

// Public component — wraps with QueryClientProvider and session key gate
const MailboxView = ({ mailboxType }: MailboxViewProps): React.ReactElement => {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        <MailboxViewInner mailboxType={mailboxType} />
      </SessionGate>
    </QueryClientProvider>
  );
};

export { MailboxView };
export type { MailboxViewProps };
