import { randomBytes } from '@noble/ciphers/utils.js';
import { argon2id } from 'hash-wasm';

const DERIVED_KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export interface Argon2idParams {
  memory: number;
  iterations: number;
  parallelism: number;
}

export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  memory: 65536,
  iterations: 3,
  parallelism: 4,
};

const assertSaltLength = (salt: Uint8Array): void => {
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Argon2id salt must be ${SALT_LENGTH} bytes`);
  }
};

const assertArgon2idParams = (params: Argon2idParams): void => {
  if (!Number.isInteger(params.memory) || params.memory <= 0) {
    throw new Error('Argon2id memory must be a positive integer');
  }

  if (!Number.isInteger(params.iterations) || params.iterations <= 0) {
    throw new Error('Argon2id iterations must be a positive integer');
  }

  if (!Number.isInteger(params.parallelism) || params.parallelism <= 0) {
    throw new Error('Argon2id parallelism must be a positive integer');
  }
};

export const deriveKey = async (
  passphrase: string | Uint8Array,
  salt: Uint8Array,
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): Promise<Uint8Array> => {
  assertSaltLength(salt);
  assertArgon2idParams(params);

  return argon2id({
    password: passphrase,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: DERIVED_KEY_LENGTH,
    outputType: 'binary',
  });
};

export const generateSalt = (): Uint8Array => randomBytes(SALT_LENGTH);
