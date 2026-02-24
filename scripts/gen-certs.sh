#!/usr/bin/env bash
# Generate a self-signed TLS certificate for local development.
set -euo pipefail
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -keyout certs/tls.key -out certs/tls.crt \
  -days 365 -nodes -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
chmod 600 certs/tls.key
echo "✓ TLS certificate written to certs/tls.crt and certs/tls.key"
