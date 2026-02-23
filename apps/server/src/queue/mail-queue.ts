import { QUEUE_NAMES } from '@enclave/types';
import { Queue } from 'bullmq';
import { createRedisConnection } from './connection.js';
import type { DeadLetterJob, InboundMailJob, OutboundMailJob } from './types.js';

/**
 * Create the outbound mail delivery queue.
 *
 * Retries up to 5 times with exponential backoff (30 s base).
 * Failed jobs are kept for dead-letter processing rather than
 * being removed automatically.
 */
export function createOutboundMailQueue(): Queue<OutboundMailJob> {
  return new Queue<OutboundMailJob>(QUEUE_NAMES.OUTBOUND_MAIL, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'outbound-mail-backoff' },
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    },
  });
}

/**
 * Create the inbound mail processing queue.
 *
 * Retries up to 3 times with exponential backoff (5 s base).
 * Failed jobs are kept for dead-letter processing.
 */
export function createInboundMailQueue(): Queue<InboundMailJob> {
  return new Queue<InboundMailJob>(QUEUE_NAMES.INBOUND_MAIL, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    },
  });
}

/**
 * Create the dead-letter queue for permanently failed jobs.
 *
 * No retry — jobs that land here have already exhausted all
 * attempts in their original queue. They are preserved for
 * manual inspection and potential replay.
 */
export function createDeadLetterQueue(): Queue<DeadLetterJob> {
  return new Queue<DeadLetterJob>(QUEUE_NAMES.DEAD_LETTER, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    },
  });
}
