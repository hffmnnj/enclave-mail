#!/usr/bin/env bash
# dev-containers.sh — Ensure Postgres and Redis containers are running and reachable.
# Safe to run repeatedly: recreates containers only when the port is unreachable.
set -euo pipefail

POSTGRES_CONTAINER="enclave-postgres-dev"
REDIS_CONTAINER="enclave-redis-dev"

check_tcp() {
  local host="$1" port="$2"
  timeout 2 bash -c "exec 3<>/dev/tcp/${host}/${port}" 2>/dev/null
}

start_postgres() {
  echo "→ Starting Postgres..."
  podman rm -f "$POSTGRES_CONTAINER" 2>/dev/null || true
  podman run -d \
    --name "$POSTGRES_CONTAINER" \
    --network pasta \
    -e POSTGRES_DB=enclave \
    -e POSTGRES_USER=enclave \
    -e POSTGRES_PASSWORD=enclave_dev_password \
    -p 5432:5432 \
    docker.io/library/postgres:16-alpine
  # Wait for port to be reachable
  for i in $(seq 1 15); do
    check_tcp 127.0.0.1 5432 && echo "  Postgres ready." && return
    sleep 1
  done
  echo "  ERROR: Postgres did not become reachable in time." >&2
  exit 1
}

start_redis() {
  echo "→ Starting Redis..."
  podman rm -f "$REDIS_CONTAINER" 2>/dev/null || true
  podman run -d \
    --name "$REDIS_CONTAINER" \
    --network pasta \
    -p 6379:6379 \
    docker.io/library/redis:7-alpine
  for i in $(seq 1 15); do
    check_tcp 127.0.0.1 6379 && echo "  Redis ready." && return
    sleep 1
  done
  echo "  ERROR: Redis did not become reachable in time." >&2
  exit 1
}

# ── Postgres ──────────────────────────────────────────────────────────────────
if check_tcp 127.0.0.1 5432; then
  echo "✓ Postgres already reachable on :5432"
else
  echo "✗ Postgres unreachable — recreating container"
  start_postgres
fi

# ── Redis ─────────────────────────────────────────────────────────────────────
if check_tcp 127.0.0.1 6379; then
  echo "✓ Redis already reachable on :6379"
else
  echo "✗ Redis unreachable — recreating container"
  start_redis
fi

echo ""
echo "All dev containers are up."
