import {
  deserializePublicKey as deserializeEd25519PublicKey,
  serializePublicKey as serializeEd25519PublicKey,
} from './ed25519.js';
import {
  decryptPrivateKeyWithPassphrase,
  encryptPrivateKeyWithPassphrase,
} from './encrypted-key-store.js';
import { type Argon2idParams, generateSalt } from './key-derivation.js';
import {
  deserializePublicKey as deserializeX25519PublicKey,
  serializePublicKey as serializeX25519PublicKey,
} from './x25519.js';

const SALT_LENGTH = 16;
const PRIVATE_KEY_LENGTH = 32;

const base64urlEncode = (bytes: Uint8Array): string => {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64urlDecode = (encoded: string): Uint8Array => {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export interface KeyBundle {
  version: 1;
  x25519_public: string;
  x25519_private_encrypted: string;
  ed25519_public: string;
  ed25519_private_encrypted: string;
  salt: string;
  created_at: string;
}

export interface ExportableKeyPairs {
  x25519: { privateKey: Uint8Array; publicKey: Uint8Array };
  ed25519: { privateKey: Uint8Array; publicKey: Uint8Array };
}

const isKeyBundleShape = (value: unknown): value is KeyBundle => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const bundle = value as Record<string, unknown>;

  return (
    bundle.version === 1 &&
    typeof bundle.x25519_public === 'string' &&
    typeof bundle.x25519_private_encrypted === 'string' &&
    typeof bundle.ed25519_public === 'string' &&
    typeof bundle.ed25519_private_encrypted === 'string' &&
    typeof bundle.salt === 'string' &&
    typeof bundle.created_at === 'string'
  );
};

const assertSharedSalt = (
  bundleSalt: Uint8Array,
  encryptedBlob: Uint8Array,
  label: string,
): void => {
  if (bundleSalt.length !== SALT_LENGTH) {
    throw new Error(`Bundle salt must be ${SALT_LENGTH} bytes`);
  }

  if (encryptedBlob.length < SALT_LENGTH) {
    throw new Error(`${label} encrypted blob is too short`);
  }

  const embeddedSalt = encryptedBlob.slice(0, SALT_LENGTH);
  const matches = embeddedSalt.every((byte, index) => byte === bundleSalt[index]);

  if (!matches) {
    throw new Error(`Bundle salt does not match ${label} encrypted salt`);
  }
};

const assertPrivateKeyLength = (key: Uint8Array, label: string): void => {
  if (key.length !== PRIVATE_KEY_LENGTH) {
    throw new Error(`${label} private key must be ${PRIVATE_KEY_LENGTH} bytes`);
  }
};

export const validateKeyBundle = (json: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(json);
    return isKeyBundleShape(parsed);
  } catch {
    return false;
  }
};

export const exportKeyBundle = async (
  keypairs: ExportableKeyPairs,
  passphrase: string,
  params?: Argon2idParams,
): Promise<string> => {
  const sharedSalt = generateSalt();

  const [encryptedX25519Private, encryptedEd25519Private] = await Promise.all([
    encryptPrivateKeyWithPassphrase(keypairs.x25519.privateKey, passphrase, sharedSalt, params),
    encryptPrivateKeyWithPassphrase(keypairs.ed25519.privateKey, passphrase, sharedSalt, params),
  ]);

  const bundle: KeyBundle = {
    version: 1,
    x25519_public: serializeX25519PublicKey(keypairs.x25519.publicKey),
    x25519_private_encrypted: base64urlEncode(encryptedX25519Private),
    ed25519_public: serializeEd25519PublicKey(keypairs.ed25519.publicKey),
    ed25519_private_encrypted: base64urlEncode(encryptedEd25519Private),
    salt: base64urlEncode(sharedSalt),
    created_at: new Date().toISOString(),
  };

  return JSON.stringify(bundle);
};

export const importKeyBundle = async (
  json: string,
  passphrase: string,
  params?: Argon2idParams,
): Promise<ExportableKeyPairs> => {
  if (!validateKeyBundle(json)) {
    throw new Error('Invalid key bundle');
  }

  const bundle = JSON.parse(json) as KeyBundle;

  const bundleSalt = base64urlDecode(bundle.salt);
  const encryptedX25519Private = base64urlDecode(bundle.x25519_private_encrypted);
  const encryptedEd25519Private = base64urlDecode(bundle.ed25519_private_encrypted);

  assertSharedSalt(bundleSalt, encryptedX25519Private, 'X25519');
  assertSharedSalt(bundleSalt, encryptedEd25519Private, 'Ed25519');

  const [x25519PrivateKey, ed25519PrivateKey] = await Promise.all([
    decryptPrivateKeyWithPassphrase(encryptedX25519Private, passphrase, params),
    decryptPrivateKeyWithPassphrase(encryptedEd25519Private, passphrase, params),
  ]);

  assertPrivateKeyLength(x25519PrivateKey, 'X25519');
  assertPrivateKeyLength(ed25519PrivateKey, 'Ed25519');

  return {
    x25519: {
      privateKey: x25519PrivateKey,
      publicKey: deserializeX25519PublicKey(bundle.x25519_public),
    },
    ed25519: {
      privateKey: ed25519PrivateKey,
      publicKey: deserializeEd25519PublicKey(bundle.ed25519_public),
    },
  };
};
