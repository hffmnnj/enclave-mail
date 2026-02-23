export interface DhKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface IdentityKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface PreKeyBundle {
  identityKey: Uint8Array;
  signedPreKey: Uint8Array;
  signedPreKeySignature: Uint8Array;
  oneTimePreKey?: Uint8Array;
  registrationId: number;
  ed25519IdentityKey: Uint8Array;
}

export interface MessageHeader {
  dhRatchetKey: Uint8Array;
  messageNumber: number;
  previousChainLength: number;
}

export interface EncryptedMessage {
  header: MessageHeader;
  ciphertext: Uint8Array;
}

export interface RatchetSession {
  dhSendingKey: Uint8Array;
  dhReceivingKey: Uint8Array | null;
  rootKey: Uint8Array;
  sendingChainKey: Uint8Array | null;
  receivingChainKey: Uint8Array | null;
  sendingMessageNumber: number;
  receivingMessageNumber: number;
  previousSendingChainLength: number;
  skippedMessageKeys: Map<string, Uint8Array>;
}

export interface X3dhInitiationResult {
  sharedSecret: Uint8Array;
  ourEphemeralPublicKey: Uint8Array;
}

export interface ExternalEncryptedMessage {
  ciphertext: Uint8Array;
  ephemeralPublicKey: Uint8Array;
}
