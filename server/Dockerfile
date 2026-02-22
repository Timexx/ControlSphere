# ── Stage 1: Install dependencies ──────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: Build Next.js app & generate Prisma client ────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

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
FROM node:20-alpine AS runner
WORKDIR /app

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
