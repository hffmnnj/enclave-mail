const Redis = require('ioredis');
const { Queue } = require('bullmq');

function buildTlsInfo(connection) {
  return {
    secured: Boolean(connection?.tls?.enabled),
    cipher: connection?.tls?.cipher || undefined,
    version: connection?.tls?.version || undefined,
  };
}

exports.register = function register() {
  this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  this.redis = new Redis(this.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(100 * 2 ** times, 10_000),
  });
  this.redis.on('error', () => undefined);

  this.inboundQueue = new Queue('inbound-mail', {
    connection: this.redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    },
  });

  this.register_hook('data_post', 'hook_data_post');
};

exports.shutdown = function shutdown() {
  const closeQueue = this.inboundQueue ? this.inboundQueue.close() : Promise.resolve();
  const closeRedis = this.redis ? this.redis.quit() : Promise.resolve();
  Promise.allSettled([closeQueue, closeRedis]).catch(() => undefined);
};

exports.hook_data_post = async function hookDataPost(next, connection) {
  const transaction = connection?.transaction;
  const sourceIp = connection?.remote?.ip || connection?.remote_ip || '';

  if (!transaction || !transaction.message_stream) {
    this.logerror(connection, 'Missing SMTP transaction stream');
    return next(DENYSOFT, 'Temporary queue error');
  }

  transaction.message_stream.get_data(async (buffer) => {
    try {
      const rawEmail = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
      const jobData = {
        rawEmail,
        sourceIp,
        tlsInfo: buildTlsInfo(connection),
      };

      await this.inboundQueue.add('inbound-mail', jobData);
      this.loginfo(connection, `Inbound mail enqueued from ${sourceIp || 'unknown-ip'}`);
      return next(OK);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown queue error';
      this.logerror(connection, `Failed to enqueue inbound mail: ${message}`);
      return next(DENYSOFT, 'Temporary queue failure');
    }
  });
};
