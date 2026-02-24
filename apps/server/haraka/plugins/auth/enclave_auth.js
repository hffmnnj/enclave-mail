const { createHash } = require('node:crypto');
const Redis = require('ioredis');

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseLoginCredentials(login, password) {
  if (typeof login !== 'string' || typeof password !== 'string') {
    return null;
  }

  const username = login.trim().toLowerCase();
  const secret = password.trim();

  if (!username || !secret) {
    return null;
  }

  return { username, secret };
}

exports.register = function register() {
  this.register_hook('auth', 'hook_auth');
  this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  this.redis = new Redis(this.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(100 * 2 ** times, 10_000),
  });
  this.redis.on('error', () => undefined);
};

exports.shutdown = function shutdown() {
  if (this.redis) {
    this.redis.quit().catch(() => undefined);
  }
};

exports.hook_auth = async function hookAuth(next, connection, params) {
  const credentials = parseLoginCredentials(params?.[0], params?.[1]);

  if (!credentials) {
    return next(DENY, 'Invalid AUTH credentials');
  }

  const tokenHash = sha256Hex(credentials.secret);
  const appPasswordKey = `smtp:apppass:${tokenHash}`;
  const sessionKey = `session:${tokenHash}`;

  try {
    const [appPasswordValue, sessionValue] = await this.redis.mget(appPasswordKey, sessionKey);
    const authSucceeded = Boolean(appPasswordValue || sessionValue);

    if (!authSucceeded) {
      this.logwarn(connection, `SMTP AUTH failed for ${credentials.username}`);
      return next(DENY, 'Authentication failed');
    }

    connection.relaying = true;
    connection.notes = connection.notes || {};
    connection.notes.authenticatedUser = credentials.username;

    this.loginfo(connection, `SMTP AUTH success for ${credentials.username}`);
    return next(OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown redis error';
    this.logerror(connection, `SMTP AUTH redis error: ${message}`);
    return next(DENYSOFT, 'Temporary authentication failure');
  }
};
