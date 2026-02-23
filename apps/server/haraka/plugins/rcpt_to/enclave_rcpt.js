const Redis = require('ioredis');

function normalizeAddress(address) {
  if (typeof address !== 'string') {
    return null;
  }

  return address.trim().toLowerCase();
}

exports.register = function register() {
  this.smtpDomain = (process.env.SMTP_DOMAIN || '').trim().toLowerCase();
  this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  this.redis = new Redis(this.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  this.register_hook('rcpt', 'hook_rcpt');
};

exports.shutdown = function shutdown() {
  if (this.redis) {
    this.redis.quit().catch(() => undefined);
  }
};

exports.hook_rcpt = async function hookRcpt(next, connection, params) {
  const recipient = params?.[0];
  const rawAddress = recipient?.address?.() || recipient?.address;
  const address = normalizeAddress(rawAddress);

  if (!address || !address.includes('@')) {
    return next(DENY, 'Invalid recipient');
  }

  const splitAddress = address.split('@');
  const domain = splitAddress[1] || '';

  if (this.smtpDomain && domain === this.smtpDomain) {
    return next(OK);
  }

  try {
    const cachedUser = await this.redis.get(`user:email:${address}`);
    if (cachedUser) {
      return next(OK);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown redis error';
    this.logerror(connection, `Recipient lookup failed: ${message}`);
    return next(DENYSOFT, 'Temporary recipient verification failure');
  }

  return next(DENY, 'Relaying denied');
};
