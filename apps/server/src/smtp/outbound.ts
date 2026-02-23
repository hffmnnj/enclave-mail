import type { OutboundMailJob } from '@enclave/types';
import type { JobsOptions, Queue } from 'bullmq';

import { createOutboundMailQueue } from '../queue/mail-queue.js';

export type OutboundMailStatus = 'queued' | 'delivered' | 'failed' | 'retrying' | 'dead';

export const OUTBOUND_RETRY_DELAYS_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const;

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'outbound-mail-backoff' },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

interface QueueAddResult {
  id?: string | number;
}

interface OutboundQueueLike {
  add: (name: string, data: OutboundMailJob, opts?: JobsOptions) => Promise<QueueAddResult>;
}

interface EnqueueOutboundMailDeps {
  queue?: OutboundQueueLike;
}

let outboundQueueSingleton: Queue<OutboundMailJob> | null = null;

function getOutboundQueue(): Queue<OutboundMailJob> {
  if (outboundQueueSingleton) {
    return outboundQueueSingleton;
  }

  outboundQueueSingleton = createOutboundMailQueue();
  return outboundQueueSingleton;
}

export async function enqueueOutboundMail(
  job: OutboundMailJob,
  deps: EnqueueOutboundMailDeps = {},
): Promise<string> {
  const queue = deps.queue ?? getOutboundQueue();
  const queuedJob = await queue.add('relay-outbound-mail', job, DEFAULT_JOB_OPTIONS);
  const jobId = queuedJob.id;

  if (jobId === undefined) {
    throw new Error('Failed to enqueue outbound mail job: missing job id');
  }

  return String(jobId);
}
