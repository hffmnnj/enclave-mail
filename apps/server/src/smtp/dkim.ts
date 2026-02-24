import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { dkimSign } from 'mailauth/lib/dkim/sign.js';

const DEFAULT_DKIM_PRIVATE_KEY_PATH = './dkim/private.key';

function normalizeRawEmail(rawEmail: string): string {
  return rawEmail.replace(/\r?\n/g, '\r\n');
}

function publicKeyPemToDkimValue(publicKeyPem: string): string {
  return publicKeyPem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '');
}

export async function signMessage(
  rawEmail: string,
  domain: string,
  selector: string,
  privateKeyPem: string,
): Promise<string> {
  const normalizedEmail = normalizeRawEmail(rawEmail);

  const result = await dkimSign(normalizedEmail, {
    signingDomain: domain,
    selector,
    privateKey: privateKeyPem,
    signatureData: [
      {
        signingDomain: domain,
        selector,
        privateKey: privateKeyPem,
        algorithm: 'rsa-sha256',
        canonicalization: 'relaxed/relaxed',
      },
    ],
  });

  if (result.errors.length > 0) {
    const firstError = result.errors[0];
    throw new Error(`DKIM signing failed: ${firstError?.message ?? 'unknown error'}`);
  }

  return `${result.signatures}${normalizedEmail}`;
}

export async function generateDkimKeyPair(): Promise<{
  privateKeyPem: string;
  publicKeyPem: string;
  dnsRecord: string;
}> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  const publicKeyValue = publicKeyPemToDkimValue(publicKey);

  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    dnsRecord: `v=DKIM1; k=rsa; p=${publicKeyValue}`,
  };
}

export async function loadDkimPrivateKey(): Promise<string> {
  const keyPath = process.env.DKIM_PRIVATE_KEY_PATH ?? DEFAULT_DKIM_PRIVATE_KEY_PATH;
  const resolvedPath = resolve(process.cwd(), keyPath);
  return readFile(resolvedPath, 'utf8');
}
