# ---- Build Stage ----
# Full Bun image with build tools for dependency installation
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy workspace manifests first for optimal layer caching.
# Changes to source code won't invalidate the dependency install layer.
COPY package.json bun.lock turbo.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY apps/server/package.json ./apps/server/

# Install all dependencies (including devDependencies for build tooling)
RUN bun install --frozen-lockfile

# Copy workspace package source
COPY packages/ ./packages/

# Copy server source (includes haraka/ config directory)
COPY apps/server/ ./apps/server/

# ---- Production Stage ----
# Slim image — @noble/* is pure JS, no native addons required
FROM oven/bun:1-slim AS production
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 enclave && \
    adduser --system --uid 1001 --ingroup enclave enclave

# Copy workspace manifests for production dependency resolution
COPY package.json bun.lock turbo.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY apps/server/package.json ./apps/server/

# Install production dependencies only (no devDependencies)
RUN bun install --frozen-lockfile --production

# Copy workspace packages source from builder
# Bun resolves TypeScript directly — no compilation step needed
COPY --from=builder /app/packages/ ./packages/

# Copy server source and Haraka config from builder
COPY --from=builder /app/apps/server/ ./apps/server/

# Switch to non-root user
USER enclave

# Health check against the Hono API health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://localhost:3001/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# HTTP API | SMTP inbound | SMTP submission | IMAPS
EXPOSE 3001 25 587 993

CMD ["bun", "run", "apps/server/src/index.ts"]
