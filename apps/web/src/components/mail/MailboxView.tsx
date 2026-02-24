/**
 * MailboxView
 *
 * Thin routing adapter that maps a mailbox type (e.g. "inbox", "sent") to its
 * UUID and delegates to InboxView. Mounted by the Astro catch-all mail route.
 */
import type * as React from 'react';

import { useMailboxes } from '../../hooks/use-mailboxes.js';
import { InboxView } from './InboxView.js';

interface MailboxViewProps {
  /** The mailbox type slug from the URL (e.g. "inbox", "sent", "drafts"). */
  mailboxType: string;
}

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

const MailboxView = ({ mailboxType }: MailboxViewProps): React.ReactElement => {
  return <MailboxViewInner mailboxType={mailboxType} />;
};

export { MailboxView };
export type { MailboxViewProps };
