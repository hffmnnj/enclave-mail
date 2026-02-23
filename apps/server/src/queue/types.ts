/**
 * Job payload for outbound mail delivery via SMTP relay.
 * Enqueued when a user sends a message; processed by the
 * outbound mail worker which handles DKIM signing and relay.
 */
export interface OutboundMailJob {
  /** UUID of the message record in the database */
  messageId: string;
  /** Sender email address */
  from: string;
  /** Recipient email addresses */
  to: string[];
  /** Reference to encrypted body (message_bodies.id) */
  encryptedBodyRef: string;
  /** Whether to apply DKIM signature to this message */
  dkimSign: boolean;
  /** Current attempt number (managed by BullMQ retry) */
  attemptCount?: number;
}

/**
 * Job payload for inbound mail processing.
 * Enqueued when the SMTP daemon receives a message from an
 * external server; processed by the inbound pipeline which
 * handles SPF/DKIM/DMARC verification and storage.
 */
export interface InboundMailJob {
  /** Raw SMTP DATA content (base64-encoded if binary) */
  rawEmail: string;
  /** Connecting IP address for SPF verification */
  sourceIp: string;
  /** TLS connection details from the SMTP session */
  tlsInfo: {
    secured: boolean;
    cipher?: string;
    version?: string;
  };
  /** ISO 8601 timestamp of when the message was received */
  receivedAt: string;
}

/**
 * Job payload for the dead-letter queue.
 * Captures permanently failed jobs after all retry attempts
 * are exhausted, preserving the original data for debugging
 * and manual intervention.
 */
export interface DeadLetterJob {
  /** Name of the queue the job originally belonged to */
  originalQueue: string;
  /** BullMQ job ID from the original queue */
  originalJobId: string;
  /** Human-readable failure reason from the last attempt */
  failureReason: string;
  /** ISO 8601 timestamp of when the job permanently failed */
  failedAt: string;
  /** Original job data for inspection and potential replay */
  originalData: OutboundMailJob | InboundMailJob;
}
