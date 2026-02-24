# ---- Build Stage ----
# Full Bun image with build tools for Astro compilation
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy workspace manifests first for optimal layer caching.
# Changes to source code won't invalidate the dependency install layer.
COPY package.json bun.lock turbo.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json ./apps/web/

# Install all dependencies (including devDependencies for Astro build)
RUN bun install --frozen-lockfile

# Copy workspace package source (needed for imports during build)
COPY packages/ ./packages/

# Copy web app source
COPY apps/web/ ./apps/web/

# Build Astro SSR output (produces dist/server/entry.mjs)
RUN bun run --cwd apps/web build

# ---- Production Stage ----
# Slim image — Astro standalone output is pure JS
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
COPY apps/web/package.json ./apps/web/

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy compiled Astro output from builder
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Copy workspace packages source (Bun resolves TS directly at runtime)
COPY --from=builder /app/packages/ ./packages/

# Copy Astro config (needed for runtime SSR configuration)
COPY --from=builder /app/apps/web/astro.config.mjs ./apps/web/

# Switch to non-root user
USER enclave

# Health check against the Astro SSR server
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://localhost:4321/').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

EXPOSE 4321

# Astro standalone node adapter entry point
CMD ["bun", "run", "apps/web/dist/server/entry.mjs"]
