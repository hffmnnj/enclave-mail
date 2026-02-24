#!/usr/bin/env bash
# Generate a DKIM RSA-2048 private key for local development.
set -euo pipefail
mkdir -p dkim
openssl genrsa -out dkim/private.key 2048 2>/dev/null
chmod 600 dkim/private.key
echo "✓ DKIM private key written to dkim/private.key"
