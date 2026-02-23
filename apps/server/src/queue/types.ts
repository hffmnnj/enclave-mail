import type {
  InboundMailJob as SharedInboundMailJob,
  OutboundMailJob as SharedOutboundMailJob,
} from '@enclave/types';

export type OutboundMailJob = SharedOutboundMailJob;

/**
 * Job payload for inbound mail processing.
 * Enqueued when the SMTP daemon receives a message from an
 * external server; processed by the inbound pipeline which
 * handles SPF/DKIM/DMARC verification and storage.
 */
export type InboundMailJob = SharedInboundMailJob;

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
