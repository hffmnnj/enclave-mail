import { Buffer } from 'node:buffer';

import { computeSharedSecret, generateX25519KeyPair } from '@enclave/crypto';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const HKDF_INFO = new TextEncoder().encode('enclave-inbound-v1');
const EMPTY_SALT = new Uint8Array(0);

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  ephemeralPublicKey: Buffer;
  encryptionMetadata: Record<string, unknown>;
}

type RecipientEncryptor = {
  ephemeralPublicKey: Buffer;
  encrypt: (plaintext: Uint8Array | Buffer) => EncryptedPayload;
};

function toUint8Array(value: Uint8Array | Buffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function toHex(value: Uint8Array | Buffer): string {
  return Buffer.from(value).toString('hex');
}

export function createRecipientEncryptor(
  recipientPublicKey: Uint8Array | Buffer,
): RecipientEncryptor {
  const normalizedRecipientPublicKey = toUint8Array(recipientPublicKey);
  const ephemeralKeyPair = generateX25519KeyPair();
  const ephemeralPublicKey = ephemeralKeyPair.publicKey;
  const sharedSecret = computeSharedSecret(
    ephemeralKeyPair.privateKey,
    normalizedRecipientPublicKey,
  );
  const symmetricKey = hkdf(sha256, sharedSecret, EMPTY_SALT, HKDF_INFO, 32);

  return {
    ephemeralPublicKey: Buffer.from(ephemeralPublicKey),
    encrypt: (plaintext: Uint8Array | Buffer): EncryptedPayload => {
      const normalizedPlaintext = toUint8Array(plaintext);
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const cipher = chacha20poly1305(symmetricKey, nonce);
      const ciphertext = cipher.encrypt(normalizedPlaintext);

      return {
        ciphertext: Buffer.from(ciphertext),
        nonce: Buffer.from(nonce),
        ephemeralPublicKey: Buffer.from(ephemeralPublicKey),
        encryptionMetadata: {
          algorithm: 'x25519-chacha20poly1305',
          ephemeralPublicKey: toHex(ephemeralPublicKey),
          nonce: toHex(nonce),
        },
      };
    },
  };
}

export async function encryptForRecipient(
  plaintext: Uint8Array | Buffer,
  recipientPublicKey: Uint8Array | Buffer,
): Promise<EncryptedPayload> {
  const encryptor = createRecipientEncryptor(recipientPublicKey);
  return encryptor.encrypt(plaintext);
}
