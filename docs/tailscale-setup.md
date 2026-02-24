# Tailscale Deployment Guide

Enclave Mail supports two deployment modes. This guide covers the **Tailscale mode**, which keeps your webmail and mail server accessible only within your private Tailscale network.

| Mode | Caddyfile | When to use |
|------|-----------|-------------|
| **Standard** | `docker/caddy/Caddyfile` | Public VPS, Let's Encrypt HTTPS, external email |
| **Tailscale** | `docker/caddy/Caddyfile.tailscale` | Private network, MagicDNS HTTPS, no public exposure |

---

## Overview

In Tailscale mode:

- **HTTPS** is provided by Tailscale's built-in certificate authority via MagicDNS — no Let's Encrypt, no public DNS challenge.
- **Webmail** (`https://your-machine.tailnet-name.ts.net`) is accessible only to devices connected to your Tailscale network.
- **Mail ports** (25, 587, 993) are reachable on the Tailscale network. Whether they are also reachable from the public internet depends on which email mode you choose (see below).
- **Two email sub-modes** are available:
  - **Enclave-to-Enclave only** — mail stays entirely within your Tailscale network; no public ports required.
  - **External email** — port 25 is exposed publicly so you can send and receive mail with the wider internet.

---

## Prerequisites

Before starting, ensure you have:

- A [Tailscale account](https://tailscale.com/) (free tier is sufficient for personal use)
- Tailscale installed on your VPS (see [VPS Setup](#vps-setup) below)
- **MagicDNS** enabled in the [Tailscale admin console](https://login.tailscale.com/admin/dns) under **DNS → MagicDNS**
- **HTTPS** enabled in the admin console under **DNS → HTTPS Certificates** — this allows Tailscale to act as a CA and issue TLS certificates for your MagicDNS hostnames

---

## VPS Setup

### 1. Install Tailscale

```bash
# Ubuntu / Debian
curl -fsSL https://tailscale.com/install.sh | sh

# Start and authenticate
sudo tailscale up --advertise-tags=tag:server
```

The `--advertise-tags=tag:server` flag is optional but recommended for ACL-based access control in the Tailscale admin console.

### 2. Find your MagicDNS hostname

```bash
tailscale status --json | jq -r '.Self.DNSName'
# Example output: enclave-mail.tailnet-name.ts.net.
# Note: strip the trailing dot when using as TAILSCALE_DOMAIN
```

Your MagicDNS FQDN will look like `enclave-mail.tailnet-name.ts.net`. This is the value you will use for `TAILSCALE_DOMAIN`.

### 3. Verify Tailscale is running

```bash
tailscale status
# Should show your machine as "online" with a 100.x.x.x IP
```

---

## Configure `.env`

Copy `.env.example` to `.env` and set the Tailscale-specific variable:

```bash
# Your Tailscale MagicDNS FQDN (no trailing dot)
TAILSCALE_DOMAIN=enclave-mail.tailnet-name.ts.net
```

All other variables (database passwords, SMTP domain, etc.) are the same as the standard deployment. See `.env.example` for the full list.

---

## Use the Tailscale Caddyfile

In `docker-compose.yml`, update the Caddy service `volumes` section to mount `Caddyfile.tailscale` instead of the default `Caddyfile`:

```yaml
caddy:
  image: caddy:2-alpine
  # ...
  environment:
    TAILSCALE_DOMAIN: ${TAILSCALE_DOMAIN}
  volumes:
    # Replace the default Caddyfile with the Tailscale variant
    - ./docker/caddy/Caddyfile.tailscale:/etc/caddy/Caddyfile:ro
    - caddy_data:/data
    - caddy_config:/config
```

Also update the `environment` block to pass `TAILSCALE_DOMAIN` instead of (or in addition to) `DOMAIN`.

---

## DNS Configuration

### Enclave-to-Enclave only mode

No public DNS records are required. Tailscale MagicDNS handles name resolution automatically for all devices on your network. Mail is delivered only between Enclave Mail instances on the same Tailscale network.

### External email mode

To send and receive mail with the wider internet, you need a public MX record pointing to your VPS's **public IP address** (not the Tailscale IP):

```
# DNS records at your domain registrar / DNS provider
MX   mail.yourdomain.com   →   your-vps-public-ip   (priority 10)
A    mail.yourdomain.com   →   your-vps-public-ip
```

Port 25 must be reachable from the public internet for inbound mail delivery. See [Limitations](#limitations) for common blockers.

You will also need SPF, DKIM, and DMARC records for deliverability:

```
# SPF — authorise your VPS to send mail for your domain
TXT  yourdomain.com   "v=spf1 ip4:your-vps-public-ip -all"

# DKIM — add the public key generated during server setup
TXT  mail._domainkey.yourdomain.com   "v=DKIM1; k=rsa; p=<your-public-key>"

# DMARC — policy for handling unauthenticated mail
TXT  _dmarc.yourdomain.com   "v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com"
```

---

## Email Modes Comparison

| Feature | Enclave-to-Enclave | External Email |
|---------|-------------------|----------------|
| Webmail access | Tailscale network only | Tailscale network only |
| Send to external addresses | ❌ No | ✅ Via public SMTP (port 25) |
| Receive from external senders | ❌ No | ✅ Via public MX record |
| Public ports required | None | Port 25 for SMTP inbound |
| IMAP from Thunderbird / iOS Mail | Tailscale connected only | Tailscale connected only |
| Privacy level | Maximum | Standard |
| DNS records required | None | MX, A, SPF, DKIM, DMARC |

---

## Start the Stack

```bash
# Pull images and start all services
docker compose up -d

# Watch logs during first startup (Caddy will request a cert from Tailscale CA)
docker compose logs -f caddy

# Verify Caddy obtained a certificate
docker compose exec caddy caddy list-certificates
```

On first start, Caddy contacts `https://api.tailscale.com/machine/acme` to obtain a TLS certificate for your MagicDNS hostname. This requires:

1. The VPS to be authenticated to Tailscale (`tailscale status` shows online)
2. HTTPS certificates enabled in the Tailscale admin console

---

## Limitations

### Port 25 may be blocked by your cloud provider

Many VPS providers (AWS, GCP, Azure, Hetzner, DigitalOcean) block outbound port 25 by default to prevent spam. If you need external email:

- **AWS**: Request port 25 unblocking via the [AWS support form](https://aws.amazon.com/forms/ec2-email-limit-rdns-request)
- **GCP**: Port 25 is permanently blocked; use a relay (SendGrid, Mailgun) instead
- **Hetzner / DigitalOcean**: Port 25 is typically available on dedicated/VPS plans; check your account limits

### Tailscale HTTPS certificates are only trusted within your Tailscale network

The TLS certificate issued by Tailscale's CA is trusted by devices that have Tailscale installed and are connected to your network. Browsers on non-Tailscale devices will show a certificate warning. This is by design — the webmail is private.

### Mail clients must be on Tailscale to connect via IMAP

Thunderbird, iOS Mail, and other IMAP clients must be connected to your Tailscale network to reach ports 587 (SMTP submission) and 993 (IMAPS). Install the Tailscale client on each device that needs mail access.

### No Let's Encrypt

Caddy uses Tailscale's CA instead of Let's Encrypt. The `acme_ca` directive in `Caddyfile.tailscale` points to `https://api.tailscale.com/machine/acme`. Do not mix this with the standard `Caddyfile`, which uses Let's Encrypt.

---

## Troubleshooting

### "Certificate not trusted" in browser

**Cause:** Tailscale HTTPS certificates are not enabled in the admin console, or the browser device is not on Tailscale.

**Fix:**
1. Go to [Tailscale admin console → DNS](https://login.tailscale.com/admin/dns)
2. Enable **HTTPS Certificates** under the MagicDNS section
3. Restart Caddy: `docker compose restart caddy`
4. Ensure the browser device has Tailscale installed and is connected

### "Can't connect to webmail"

**Cause:** The VPS is not connected to Tailscale, or the client device is not connected.

**Fix:**
```bash
# On the VPS
tailscale status
# Should show: enclave-mail  100.x.x.x  tagged-devices  online

# If offline, re-authenticate
sudo tailscale up
```

On the client device, check the Tailscale app shows a green connected state.

### "External mail not working" (external email mode only)

**Cause:** Port 25 is blocked, MX record is missing, or points to the wrong IP.

**Fix:**
```bash
# Check if port 25 is reachable from outside (run from a different machine)
nc -zv your-vps-public-ip 25

# Verify MX record resolves correctly
dig MX yourdomain.com

# Check server logs for SMTP errors
docker compose logs server | grep -i smtp
```

### Caddy fails to start with ACME error

**Cause:** The VPS cannot reach `api.tailscale.com`, or Tailscale is not authenticated.

**Fix:**
```bash
# Verify Tailscale connectivity
tailscale ping api.tailscale.com

# Check Caddy logs for the specific ACME error
docker compose logs caddy
```

---

## Switching Between Modes

To switch from Tailscale mode back to standard mode (or vice versa):

1. Update the `volumes` mount in `docker-compose.yml` to point to the desired Caddyfile
2. Update the `environment` block (`DOMAIN` for standard, `TAILSCALE_DOMAIN` for Tailscale)
3. Restart Caddy: `docker compose restart caddy`

Caddy will automatically request a new certificate from the appropriate CA on restart.
