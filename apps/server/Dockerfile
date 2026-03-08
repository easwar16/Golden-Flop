# ── Stage 1: Install & Build ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json turbo.json ./

# Copy workspace package.json files for dependency resolution
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/

# Install all dependencies
RUN npm ci

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/

# Generate Prisma client
RUN cd apps/server && npx prisma generate

# Build shared package first, then server
RUN npx turbo run build --filter=@goldenflop/server...

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# Copy built output and dependencies
COPY --from=builder /app/package.json /app/package-lock.json /app/turbo.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Expose the server port
EXPOSE 4010

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4010/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
