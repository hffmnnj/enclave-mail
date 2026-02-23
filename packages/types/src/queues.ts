/**
 * Shared queue name constants for BullMQ queues.
 *
 * Import from `@enclave/types` in any package or app to ensure
 * consistent queue naming across producers, consumers, and workers.
 */
export const QUEUE_NAMES = {
  OUTBOUND_MAIL: 'outbound-mail',
  INBOUND_MAIL: 'inbound-mail',
  DEAD_LETTER: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface InboundMailJob {
  rawEmail: string;
  sourceIp: string;
  tlsInfo: {
    secured: boolean;
    cipher?: string;
    version?: string;
  };
}

export interface OutboundMailJob {
  to: string[];
  from: string;
  encryptedBodyRef: string;
  dkimSign: boolean;
  /**
   * Raw MIME message provided by the client for SMTP relay.
   * When present the outbound worker can relay this directly
   * instead of building MIME from the stored encrypted body.
   */
  mimeBody?: string;
}
