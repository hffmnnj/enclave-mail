import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { generateDkimKeyPair } from '../apps/server/src/smtp/dkim.js';

const DKIM_DIR = resolve(process.cwd(), 'dkim');
const PRIVATE_KEY_PATH = resolve(DKIM_DIR, 'private.key');
const PUBLIC_KEY_PATH = resolve(DKIM_DIR, 'public.key');

const selector = process.env.DKIM_SELECTOR ?? 'mail';
const domain = process.env.SMTP_DOMAIN ?? 'example.com';

const { privateKeyPem, publicKeyPem, dnsRecord } = await generateDkimKeyPair();

await mkdir(DKIM_DIR, { recursive: true });
await writeFile(PRIVATE_KEY_PATH, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
await writeFile(PUBLIC_KEY_PATH, publicKeyPem, { encoding: 'utf8' });

console.log(`Saved private key: ${PRIVATE_KEY_PATH}`);
console.log(`Saved public key: ${PUBLIC_KEY_PATH}`);
console.log(`${selector}._domainkey.${domain} IN TXT "${dnsRecord}"`);
