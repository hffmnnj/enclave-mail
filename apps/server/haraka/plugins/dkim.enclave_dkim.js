const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { dkimSign } = require('mailauth/lib/dkim/sign');

const DEFAULT_SELECTOR = 'mail';
const DEFAULT_KEY_PATH = './dkim/private.key';

function toRawEmail(buffer) {
  if (Buffer.isBuffer(buffer)) {
    return buffer.toString('utf8');
  }

  return String(buffer || '');
}

function normalizeNewlines(input) {
  return input.replace(/\r?\n/g, '\r\n');
}

function parseAddress(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const angleMatch = value.match(/<([^>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : value).trim().toLowerCase();

  return candidate.includes('@') ? candidate : null;
}

function extractSenderDomain(transaction) {
  const fromHeader = transaction?.header?.get_decoded
    ? transaction.header.get_decoded('from')
    : transaction?.header?.get
      ? transaction.header.get('from')
      : '';

  const sender = parseAddress(fromHeader);
  if (!sender) {
    return null;
  }

  const atIndex = sender.lastIndexOf('@');
  if (atIndex === -1 || atIndex === sender.length - 1) {
    return null;
  }

  return sender.slice(atIndex + 1);
}

function splitDkimHeaders(signatureBlock) {
  const headers = [];
  const lines = signatureBlock.split(/\r?\n/);
  let current = '';

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    if (/^DKIM-Signature:/i.test(line)) {
      if (current) {
        headers.push(current);
      }
      current = line;
      continue;
    }

    if ((line.startsWith(' ') || line.startsWith('\t')) && current) {
      current += line;
    }
  }

  if (current) {
    headers.push(current);
  }

  return headers;
}

exports.register = function register() {
  this.selector = process.env.DKIM_SELECTOR || DEFAULT_SELECTOR;
  this.defaultDomain = process.env.SMTP_DOMAIN || '';
  const configuredPath = process.env.DKIM_PRIVATE_KEY_PATH || DEFAULT_KEY_PATH;

  try {
    this.privateKeyPem = readFileSync(resolve(process.cwd(), configuredPath), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown key load error';
    this.privateKeyPem = null;
    this.logerror(`DKIM key load failed: ${message}`);
  }

  this.register_hook('queue_outbound', 'hook_queue_outbound');
};

exports.hook_queue_outbound = async function hookQueueOutbound(next, connection) {
  if (!connection?.relaying) {
    return next();
  }

  const transaction = connection.transaction;
  if (!transaction || !transaction.message_stream) {
    this.logerror(connection, 'Missing transaction stream for DKIM signing');
    return next(DENYSOFT, 'Temporary outbound signing error');
  }

  if (!this.privateKeyPem) {
    this.logerror(connection, 'DKIM private key is not loaded');
    return next(DENYSOFT, 'Temporary outbound signing error');
  }

  const signingDomain = this.defaultDomain || extractSenderDomain(transaction);
  if (!signingDomain) {
    this.logerror(connection, 'Unable to determine DKIM signing domain');
    return next(DENYSOFT, 'Temporary outbound signing error');
  }

  transaction.message_stream.get_data(async (buffer) => {
    try {
      const rawEmail = normalizeNewlines(toRawEmail(buffer));
      const signing = await dkimSign(rawEmail, {
        signingDomain,
        selector: this.selector,
        privateKey: this.privateKeyPem,
        signatureData: [
          {
            signingDomain,
            selector: this.selector,
            privateKey: this.privateKeyPem,
            algorithm: 'rsa-sha256',
            canonicalization: 'relaxed/relaxed',
          },
        ],
      });

      if (Array.isArray(signing.errors) && signing.errors.length > 0) {
        const firstError = signing.errors[0];
        throw new Error(firstError?.message || 'unknown signing error');
      }

      const headers = splitDkimHeaders(signing.signatures || '');
      for (const header of headers) {
        const separatorIndex = header.indexOf(':');
        if (separatorIndex === -1) {
          continue;
        }

        const name = header.slice(0, separatorIndex).trim();
        const value = header.slice(separatorIndex + 1).trim();
        transaction.add_header(name, value);
      }

      this.loginfo(connection, `Applied DKIM signature for ${signingDomain}`);
      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown signing error';
      this.logerror(connection, `Outbound DKIM signing failed: ${message}`);
      return next(DENYSOFT, 'Temporary outbound signing error');
    }
  });
};
