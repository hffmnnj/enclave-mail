# Key Management Guide

## Overview

Enclave Mail uses end-to-end encryption with keys you control entirely. Your private keys are generated in your browser, encrypted with your passphrase, and never transmitted to the server in plaintext. This guide explains how your keys work and how to manage them safely.

## Your Keys Explained

Enclave Mail generates two key pairs for you during registration:

| Key Type | Algorithm | Purpose |
|----------|-----------|---------|
| Encryption key | X25519 (ECDH) | Encrypting and decrypting message content |
| Signing key | Ed25519 | Signing and verifying message authenticity |

Both key pairs are:

- **Generated in your browser** — private keys never leave your device unencrypted
- **Protected by your passphrase** using Argon2id key derivation (64 MiB memory, 3 iterations) + ChaCha20-Poly1305 authenticated encryption
- **Exportable as `enclave-keys.json`** — your portable backup file

The server stores only your encrypted private keys and your public keys. It cannot decrypt your messages.

---

## Key Export (Backup)

### Why export your keys?

Your keys are the only way to decrypt your messages. If you lose your passphrase or access to your device, there is no recovery mechanism — not from the server, not from the Enclave Mail team. Export your keys and store them securely before you need them.

Key export is mandatory during onboarding and cannot be skipped.

### How to export

1. Open **Settings → Key Management**
2. Click **Export Keys**
3. Enter your passphrase to confirm
4. Save the downloaded `enclave-keys.json` file securely

### Where to store your backup

| Storage option | Notes |
|----------------|-------|
| Password manager (Bitwarden, 1Password) | Best option — encrypted, synced, accessible |
| Encrypted external drive | Good offline backup |
| Secure cloud storage (Tresorit, etc.) | Acceptable if the storage itself is encrypted |
| Paper backup of passphrase in a fireproof safe | Useful as a last resort for the passphrase |

Store the file and your passphrase separately. The file alone is useless without the passphrase.

### What's in `enclave-keys.json`

The export file is a JSON bundle with this structure:

```json
{
  "version": 1,
  "x25519_public": "<base64url-encoded X25519 public key>",
  "x25519_private_encrypted": "<base64url-encoded encrypted X25519 private key>",
  "ed25519_public": "<base64url-encoded Ed25519 public key>",
  "ed25519_private_encrypted": "<base64url-encoded encrypted Ed25519 private key>",
  "salt": "<base64url-encoded Argon2id salt>",
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

The private keys are encrypted with your passphrase using Argon2id + ChaCha20-Poly1305. The file alone is useless without your passphrase — it contains no plaintext private key material.

---

## Key Import (Restoring from Backup)

If you are setting up on a new device or browser:

1. Navigate to your Enclave Mail instance
2. Click **Import Existing Keys** on the login page
3. Select your `enclave-keys.json` backup file
4. Enter your passphrase
5. Your account is restored — existing messages will decrypt normally

The import process decrypts your private keys in the browser using your passphrase and re-registers them with the server. No private key material is sent over the network.

---

## Key Rotation

Key rotation generates new X25519 and Ed25519 key pairs, replacing your current active keys.

### When to rotate

- Your passphrase may have been compromised
- Security best practice (annually or after a suspected breach)
- After restoring your account on a new device as a precaution

### What happens to old messages

Old messages remain encrypted with your previous keys. After rotation:

- **New messages** use your new keys
- **Old messages** remain readable — Enclave Mail retains your previous key pairs in its key history
- Rotation does not make old messages unreadable

### How to rotate

1. Open **Settings → Key Management → Rotate Keys**
2. The wizard generates new key pairs in your browser
3. **Export your new keys** — this step is mandatory and cannot be skipped
4. Confirm the export to activate your new keys on the server

---

## Changing Your Passphrase

Your passphrase protects your encrypted key bundle. Changing it re-encrypts your private keys locally with the new passphrase.

### Steps

1. Open **Settings → Account → Change Passphrase**
2. Enter your current passphrase
3. Enter and confirm your new passphrase (minimum 8 characters; 20+ recommended)
4. Your keys are re-encrypted with the new passphrase in your browser
5. **Export your keys again** — your previous backup is now outdated

> ⚠️ Your old `enclave-keys.json` is encrypted with your **old** passphrase. After changing your passphrase, export a fresh backup immediately. The old file will not work with the new passphrase.

### Passphrase strength recommendations

| Passphrase type | Example | Strength |
|-----------------|---------|----------|
| Random words (diceware) | `correct-horse-battery-staple` | Strong |
| Long phrase | `My cat turned 7 in January 2024!` | Strong |
| Short word + numbers | `summer2024` | Weak — avoid |
| Common word | `password` | Very weak — avoid |

Use a password manager to generate and store a strong passphrase.

---

## What If I Lose My Passphrase?

**Your data is permanently lost.** This is by design.

Enclave Mail has no server-side key recovery mechanism. This is a deliberate security property: it means neither the server operator nor an attacker can ever decrypt your messages — even under legal compulsion.

If you lose your passphrase:

- You can create a new account with a fresh passphrase
- Old messages from the lost account cannot be recovered
- This is the same security model used by end-to-end encrypted messengers like Signal

The only protection against passphrase loss is a secure backup of both your `enclave-keys.json` file and your passphrase, stored separately.

---

## Comparison: Key Management Approaches

| Feature | Enclave Mail | Proton Mail | Tuta | Standard Email |
|---------|-------------|-------------|------|----------------|
| Keys controlled by | You | Proton (can recover) | Tuta (can recover) | Mail provider |
| Passphrase loss | Data lost (by design) | Account recovery via backup phrase | Account recovery via recovery code | N/A |
| Server sees plaintext | Never | Never | Never | Always |
| Self-hosted | ✅ Yes | ❌ No | ❌ No | ✅ Yes (Postfix, etc.) |
| Key export | ✅ Mandatory | ✅ Optional | ✅ Optional | N/A |
| Recovery mechanism | ❌ None | ✅ Recovery phrase | ✅ Recovery code | N/A |
| E2E encryption by default | ✅ Always | ✅ Always | ✅ Always | ❌ Opt-in (S/MIME, PGP) |
| Open source | ✅ Fully | Partial | Partial | Varies |

### Why no recovery mechanism?

With a recovery mechanism, someone must hold the recovery key — creating a target for attackers, subpoenas, and data breaches. Enclave Mail's design means there is nothing to steal: the server holds only encrypted key material that is useless without your passphrase.

---

## Technical Reference

### Key derivation

Argon2id is used to derive a 256-bit encryption key from your passphrase and a random 16-byte salt. Default parameters:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Memory | 64 MiB (65,536 KiB) | OWASP recommended minimum |
| Iterations | 3 | Time cost |
| Parallelism | 4 | Thread count |
| Output length | 32 bytes | 256-bit key |

### Encryption

Private keys are encrypted using ChaCha20-Poly1305 (AEAD):

- A random 12-byte nonce is generated per encryption operation
- The 16-byte Argon2id salt is prepended to the encrypted blob for self-contained decryption
- The authentication tag (16 bytes) is appended by ChaCha20-Poly1305 and verified on decryption

### Session encryption

Message sessions use the Signal Protocol:

- **X3DH** (Extended Triple Diffie-Hellman) for initial key agreement
- **Double Ratchet** for forward secrecy within a session

This means that even if a session key is compromised, past messages remain protected.
