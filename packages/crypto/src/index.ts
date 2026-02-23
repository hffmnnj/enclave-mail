// @enclave/crypto — Cryptographic primitives for Enclave Mail
// Wave 3 will implement X25519, Ed25519, Argon2id, SRP, and Double Ratchet

export const CRYPTO_PACKAGE_VERSION = '0.0.1';

export {
  deserializePrivateKey as deserializeEd25519PrivateKey,
  deserializePublicKey as deserializeEd25519PublicKey,
  generateEd25519KeyPair,
  getFingerprint,
  serializePrivateKey as serializeEd25519PrivateKey,
  serializePublicKey as serializeEd25519PublicKey,
  sign,
  verify,
} from './ed25519.js';

export {
  computeSharedSecret,
  deserializePrivateKey,
  deserializePublicKey,
  generateX25519KeyPair,
  serializePrivateKey,
  serializePublicKey,
} from './x25519.js';
