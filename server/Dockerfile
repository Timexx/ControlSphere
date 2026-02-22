# ── Stage 1: Install dependencies ──────────────────────────────────────────
# Use Debian Slim instead of Alpine — Prisma 5.x requires OpenSSL 1.1 / 3.x
# libraries that are properly packaged only on glibc-based distros.
FROM node:20-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: Build Next.js app & generate Prisma client ────────────────────
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Suppress Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Provide a dummy DATABASE_URL so `next build` does not fail on env validation
# (the real URL is injected at runtime via docker-compose)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma generate + next build (defined in package.json "build" script)
RUN npm run build

# ── Stage 3: Production runner ──────────────────────────────────────────────
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
COPY --from=builder /app/.next          ./.next
COPY --from=builder /app/public         ./public
COPY --from=builder /app/prisma         ./prisma
COPY --from=builder /app/src            ./src
COPY --from=builder /app/server.js      ./server.js
COPY --from=builder /app/package.json   ./package.json
COPY --from=builder /app/tsconfig.json  ./tsconfig.json
COPY --from=builder /app/next.config.js ./next.config.js

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
