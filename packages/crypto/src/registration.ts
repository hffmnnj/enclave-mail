import { generateEd25519KeyPair } from './ed25519.js';
import { encryptPrivateKey } from './encrypted-key-store.js';
import { deriveKey, generateSalt } from './key-derivation.js';
import { exportKeyBundle } from './key-export.js';
import { srpRegister } from './srp/client.js';
import { generateX25519KeyPair } from './x25519.js';

const KEY_DERIVATION_SALT_LENGTH = 16;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const assertNonEmptyString = (value: string, label: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
};

export type RegistrationBundle = {
  salt: string;
  verifier: string;
  x25519KeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
  ed25519KeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
  x25519PublicHex: string;
  ed25519PublicHex: string;
  encryptedX25519PrivateHex: string;
  encryptedEd25519PrivateHex: string;
  keyExportBundle: string;
};

export const generateRegistrationBundle = async (
  email: string,
  passphrase: string,
): Promise<RegistrationBundle> => {
  assertNonEmptyString(email, 'Email');
  assertNonEmptyString(passphrase, 'Passphrase');

  const keyDerivationSalt = generateSalt();
  const derivedKey = await deriveKey(passphrase, keyDerivationSalt);

  const x25519KeyPair = generateX25519KeyPair();
  const ed25519KeyPair = generateEd25519KeyPair();

  const encryptedX25519Private = encryptPrivateKey(x25519KeyPair.privateKey, derivedKey);
  const encryptedEd25519Private = encryptPrivateKey(ed25519KeyPair.privateKey, derivedKey);

  const registration = srpRegister(email, passphrase);
  const keyExportBundle = await exportKeyBundle(
    {
      x25519: x25519KeyPair,
      ed25519: ed25519KeyPair,
    },
    passphrase,
  );

  const encryptedX25519WithSalt = new Uint8Array(
    KEY_DERIVATION_SALT_LENGTH + encryptedX25519Private.length,
  );
  encryptedX25519WithSalt.set(keyDerivationSalt, 0);
  encryptedX25519WithSalt.set(encryptedX25519Private, KEY_DERIVATION_SALT_LENGTH);

  const encryptedEd25519WithSalt = new Uint8Array(
    KEY_DERIVATION_SALT_LENGTH + encryptedEd25519Private.length,
  );
  encryptedEd25519WithSalt.set(keyDerivationSalt, 0);
  encryptedEd25519WithSalt.set(encryptedEd25519Private, KEY_DERIVATION_SALT_LENGTH);

  return {
    salt: registration.salt,
    verifier: registration.verifier,
    x25519KeyPair,
    ed25519KeyPair,
    x25519PublicHex: toHex(x25519KeyPair.publicKey),
    ed25519PublicHex: toHex(ed25519KeyPair.publicKey),
    encryptedX25519PrivateHex: toHex(encryptedX25519WithSalt),
    encryptedEd25519PrivateHex: toHex(encryptedEd25519WithSalt),
    keyExportBundle,
  };
};
