# Troubleshooting Guide

This guide covers the most common issues encountered when running Enclave Mail. Start with `docker compose logs --tail=100 <service>` to get context before diving into a specific section.

---

## 1. SMTP Delivery Failures

### Messages not being delivered to external recipients

**Check DKIM, SPF, and DMARC records first.**

DKIM keys are generated with:

```bash
bun run scripts/generate-dkim-keys.ts
```

This outputs the DNS TXT record you need to add. Verify it is live:

```bash
# Replace 'mail' with your DKIM_SELECTOR value if different
dig TXT mail._domainkey.your-domain.com +short
```

Check that the DKIM private key is accessible inside the container:

```bash
docker compose exec server ls -la /certs/dkim.key
```

Verify the path matches `DKIM_PRIVATE_KEY_PATH` in your `.env`.

**Check mail logs for delivery errors:**

```bash
docker compose logs server | grep -i "smtp\|dkim\|delivery\|bounce"
```

**Test your mail score:**

Send a test message to [mail-tester.com](https://mail-tester.com) and check your score. A score below 8/10 usually indicates missing or misconfigured DKIM, SPF, or DMARC records. Fix those before investigating IP reputation.

**Check if your IP is on a blocklist:**

Use [MXToolbox Blacklist Check](https://mxtoolbox.com/blacklists.aspx). If your IP is listed, follow the delisting instructions for each blocklist. New IP addresses from cloud providers are sometimes pre-listed — check before sending.

---

### Port 25 is blocked

Many cloud providers block outbound port 25 by default to prevent spam. Check your provider:

| Provider | Port 25 status | Action required |
|----------|---------------|-----------------|
| Hetzner | Allowed by default | None |
| DigitalOcean | Blocked by default | Open a support ticket to enable SMTP |
| AWS EC2 | Blocked by default | Submit the [EC2 email limit removal request](https://aws.amazon.com/forms/ec2-email-limit-rdns-request) |
| GCP | Permanently blocked | Use an SMTP relay (SendGrid, Mailgun, etc.) |
| OVH | Generally allowed | Check your account plan |

Test whether port 25 is reachable from outside your server (run from a different machine):

```bash
nc -zv your-server-ip 25
```

---

### Outbound relay failing

```bash
docker compose logs server | grep -i "relay\|failed\|rejected\|refused"
```

Common causes:

- **Recipient's server rejects your IP**: Check your IP reputation and ensure DKIM/SPF/DMARC are configured correctly
- **DNS resolution fails inside the container**: Check Docker's DNS by running `docker compose exec server nslookup gmail.com` — if this fails, check your host's DNS configuration

---

## 2. IMAP Connection Issues

### Thunderbird (or another client) won't connect

**Verify port 993 is reachable:**

```bash
# Run from your local machine
nc -zv your-domain.com 993
# Expected: Connection to your-domain.com 993 port [tcp/*] succeeded!
```

If the connection is refused, check that the server container is running and port 993 is exposed:

```bash
docker compose ps
docker compose logs server | grep -i "imap\|993"
```

**Check the TLS certificate:**

```bash
openssl s_client -connect your-domain.com:993 -quiet 2>&1 | head -20
```

- **Self-signed certificate (development)**: Add a security exception in Thunderbird under **Edit → Settings → Privacy & Security → Certificates → Manage Certificates → Servers**
- **Production**: Ensure Caddy has obtained a Let's Encrypt certificate — check with `docker compose logs caddy | grep -i "cert\|acme\|tls"`

**Authentication settings for Thunderbird:**

| Setting | Value |
|---------|-------|
| Server hostname | your-domain.com |
| Port | 993 |
| Connection security | SSL/TLS |
| Authentication method | Normal password |
| Username | your full email address (e.g. `you@your-domain.com`) |
| Password | Your Enclave Mail passphrase |

If authentication fails, verify your credentials by logging in via the webmail first.

---

### IMAP client shows "connection timed out"

- Confirm the server container is healthy: `docker compose ps`
- Check that no firewall rule is blocking port 993 on the host
- If using Tailscale mode, ensure your client device is connected to the Tailscale network — see [docs/tailscale-setup.md](./tailscale-setup.md)

---

## 3. Encryption Errors

### "Unable to decrypt message"

This error means the message was encrypted with a key that does not match your current active key.

**Possible causes:**

1. Key mismatch after key rotation without completing the handshake
2. Wrong backup file imported (e.g. keys from a different account)
3. Corrupted key export file

**Steps to resolve:**

1. Open **Settings → Key Management** and note your current key fingerprint
2. Compare it with the fingerprint shown in the Security Status Bar
3. If they do not match, import the correct `enclave-keys.json` backup
4. If you have multiple backups, try each one — the correct backup will have a fingerprint matching the one shown in the UI

---

### "Session key not found"

The in-memory session key was cleared. This happens after a page reload, browser restart, or session timeout — it is **expected behaviour**, not a bug.

Private keys are never stored in `localStorage` or `sessionStorage`. They exist only in memory during an active session.

**Resolution:** Log out and log back in. After re-authenticating, your session key is restored and messages will decrypt normally.

---

### "Invalid key bundle format"

The `enclave-keys.json` file is corrupted, truncated, or from an incompatible version.

**Steps:**

1. Confirm you have the correct file — check the filename and file size (a valid bundle is a few kilobytes of JSON)
2. Open the file in a text editor and verify it starts with `{"version":1,` and contains the expected fields
3. Try a different backup if available
4. If no valid backup exists, the messages from that account cannot be recovered — see [Key Management Guide](./key-management.md#what-if-i-lose-my-passphrase)

---

### "Wrong passphrase" during key import

The passphrase you entered does not match the one used to encrypt the key bundle. ChaCha20-Poly1305 authentication will fail if the passphrase is incorrect.

- Check for typos, especially with special characters
- Verify Caps Lock is not on
- If you changed your passphrase after exporting, use the passphrase that was active at the time of export

---

## 4. Docker Issues

### Containers won't start

```bash
# Check the status of all services
docker compose ps

# View logs for the failing service
docker compose logs postgres
docker compose logs redis
docker compose logs server
docker compose logs web
docker compose logs caddy
```

**Common causes:**

**Missing required environment variables:**

`POSTGRES_PASSWORD` and `REDIS_PASSWORD` are required in production and have no defaults. If either is unset, `docker compose up` will fail immediately with an error like:

```
variable is not set. Defaulting to a blank string.
```

Copy `.env.example` to `.env` and fill in all required values.

**Port conflicts:**

Check whether the required ports are already in use on the host:

```bash
ss -tlnp | grep -E ':25|:587|:993|:80|:443'
```

If a port is in use, stop the conflicting service or change the host port mapping in `docker-compose.yml`.

**Insufficient disk space:**

```bash
df -h
docker system df
```

If disk is full, prune unused images and volumes: `docker system prune` (does not affect named volumes).

---

### Database migration errors

Migrations run automatically when the server starts. If they fail:

```bash
# Check PostgreSQL logs
docker compose logs postgres

# Run migrations manually
docker compose exec server bun run /app/packages/db/src/migrate.ts
```

If the database schema is in an inconsistent state and you are in a development environment:

```bash
# ⚠️ This destroys all data — development only
docker compose down -v
docker compose up -d
```

Do not run `down -v` in production.

---

### Volume permission errors

```bash
# Check PostgreSQL data directory ownership
docker compose exec postgres ls -la /var/lib/postgresql/data
# Should be owned by the postgres user (UID 999)
```

If permissions are wrong, the volume may have been created by root. Remove and recreate it (development only):

```bash
docker compose down -v
docker volume rm enclave_postgres_data
docker compose up -d
```

---

### "Service unhealthy" in `docker compose ps`

Check the health check output for the specific container:

```bash
# Get the container ID
docker compose ps -q server

# Inspect health status
docker inspect <container_id> | jq '.[0].State.Health'
```

Test the server health endpoint manually:

```bash
docker compose exec server bun -e "fetch('http://localhost:3001/health').then(r=>r.json()).then(console.log)"
# Expected: { status: 'healthy', timestamp: '...' }
```

If the server is unhealthy, check its logs for startup errors:

```bash
docker compose logs --tail=50 server
```

---

### Caddy fails to obtain a TLS certificate

```bash
docker compose logs caddy | grep -i "error\|acme\|cert\|tls"
```

**Let's Encrypt (standard mode):**

- Ensure port 80 is reachable from the internet — Let's Encrypt uses HTTP-01 challenge
- Verify `DOMAIN` in `.env` resolves to your server's public IP: `dig A your-domain.com`
- Check you have not hit Let's Encrypt rate limits (5 certificates per domain per week)

**Tailscale mode:**

- Verify the VPS is connected to Tailscale: `tailscale status`
- Ensure HTTPS certificates are enabled in the [Tailscale admin console](https://login.tailscale.com/admin/dns)
- See [docs/tailscale-setup.md](./tailscale-setup.md) for full Tailscale troubleshooting

---

## 5. Performance Issues

### Slow message loading

**Client-side decryption is expected to take a moment** on initial page load — every message body is decrypted in the browser using your session key. This is the cost of end-to-end encryption.

For large mailboxes (1,000+ messages), consider archiving old messages to reduce the initial load.

**Check database performance:**

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U enclave -d enclave

# Check table sizes
SELECT pg_size_pretty(pg_total_relation_size('messages')) AS messages_size,
       pg_size_pretty(pg_total_relation_size('message_bodies')) AS bodies_size;

-- Check row counts
SELECT COUNT(*) FROM messages;

-- Run maintenance
VACUUM ANALYZE messages;
VACUUM ANALYZE message_bodies;
```

**Check Redis memory usage:**

```bash
docker compose exec redis redis-cli -a "${REDIS_PASSWORD}" INFO memory | grep used_memory_human
```

If Redis memory is unexpectedly high, check for stuck BullMQ jobs:

```bash
# Count active queue keys
docker compose exec redis redis-cli -a "${REDIS_PASSWORD}" KEYS "bull:*" | wc -l
```

A large number of stuck keys may indicate a worker crash. Restart the server to clear them:

```bash
docker compose restart server
```

---

### High CPU usage

**Check for stuck queue workers:**

```bash
docker compose logs server | grep -i "worker\|queue\|stalled"
```

**Check for IMAP IDLE connections:**

A spike in CPU when many clients are connected via IMAP IDLE is expected — each connection maintains a persistent TCP session. This is normal for active users.

**Check for runaway Argon2id operations:**

If many users are logging in simultaneously, Argon2id key derivation (64 MiB per operation) can spike CPU. This is expected and will settle once sessions are established.

---

### High memory usage in the server container

Argon2id allocates 64 MiB per key derivation operation. Under concurrent login load, memory usage will spike temporarily. If memory usage does not return to baseline after login activity settles, check for memory leaks in the BullMQ workers:

```bash
docker compose logs server | grep -i "heap\|memory\|oom"
docker stats server
```

---

## Getting Help

1. **Check logs first:** `docker compose logs --tail=100 <service>`
2. **Search existing issues:** [github.com/hffmnnj/enclave-mail/issues](https://github.com/hffmnnj/enclave-mail/issues)
3. **Open a new issue** with the relevant log output and your environment details (OS, Docker version, cloud provider)

When reporting an issue, include:

```bash
# Collect diagnostic info
docker compose version
docker version
docker compose ps
docker compose logs --tail=50 server 2>&1 | tail -50
```
