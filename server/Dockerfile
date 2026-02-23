# ── Stage 1: Install dependencies ──────────────────────────────────────────
# Use Debian Slim instead of Alpine — Prisma 5.x requires OpenSSL 1.1 / 3.x
# libraries that are properly packaged only on glibc-based distros.
FROM node:20-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Update npm to latest for security fixes
RUN npm install -g npm@11.10.1

COPY server/package.json server/package-lock.json* ./
RUN npm ci

# ── Stage 2: Build Agent Binaries (Go cross-compilation) ───────────────────
FROM golang:1.21-alpine AS agent-builder
WORKDIR /src

# Copy agent source from parent directory
# (docker-compose build context must be the repo root for this to work)
COPY agent/go.mod agent/go.sum* ./
RUN CGO_ENABLED=0 go mod download

COPY agent/ ./

# Ensure go.sum is up to date (in case source was modified)
RUN go mod tidy

# Cross-compile for all target platforms
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/maintainer-agent-linux-amd64 -ldflags="-s -w" . && \
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o bin/maintainer-agent-linux-arm64 -ldflags="-s -w" . && \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o bin/maintainer-agent-windows-amd64.exe -ldflags="-s -w" . && \
    CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -o bin/maintainer-agent-windows-arm64.exe -ldflags="-s -w" . && \
    cp bin/maintainer-agent-linux-amd64 bin/maintainer-agent

# ── Stage 3: Build Next.js app & generate Prisma client ────────────────────
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Suppress Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Provide a dummy DATABASE_URL so `next build` does not fail on env validation
# (the real URL is injected at runtime via docker-compose)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

COPY --from=deps /app/node_modules ./node_modules
COPY server/ .

# prisma generate + next build (defined in package.json "build" script)
RUN npm run build

# ── Stage 4: Production runner ──────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

# openssl is needed at runtime by both Prisma and docker-entrypoint.sh
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# server.js uses ts-node to compile and run src/server.ts at runtime,
# so we need: full node_modules, TypeScript sources, tsconfig, and the
# Next.js build output (.next).
COPY --from=builder /app/node_modules   ./node_modules
COPY --from=builder /app/package.json   ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

# Remove devDependencies from production image to reduce attack surface
# (prisma + typescript have been moved to dependencies since they're needed at runtime)
RUN npm prune --production && rm -rf /root/.npm
COPY --from=builder /app/.next          ./.next
COPY --from=builder /app/public         ./public
COPY --from=builder /app/prisma         ./prisma
COPY --from=builder /app/src            ./src
COPY --from=builder /app/server.js      ./server.js
COPY --from=builder /app/tsconfig.json  ./tsconfig.json
COPY --from=builder /app/next.config.js ./next.config.js

# Copy pre-compiled agent binaries from agent-builder stage
COPY --from=agent-builder /src/bin/ ./public/downloads/

COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY server/scripts/ ./scripts/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    chmod +x ./scripts/*.sh 2>/dev/null || true

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
