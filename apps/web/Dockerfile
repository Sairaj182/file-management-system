# Build context must be the monorepo root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY packages/auth/package.json ./packages/auth/
COPY packages/database/package.json ./packages/database/
COPY packages/env/package.json ./packages/env/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/ui/package.json ./packages/ui/
RUN pnpm install --frozen-lockfile
# Generate Prisma client - needs schema only, no DB connection required
COPY packages/database/prisma ./packages/database/prisma
COPY packages/database/prisma.config.ts ./packages/database/prisma.config.ts
RUN pnpm --filter @repo/database run db:generate

FROM base AS builder
WORKDIR /app
# Copy the full installed workspace (root + all package node_modules) from deps
COPY --from=deps /app .
# Overlay source files (.dockerignore excludes node_modules so they stay intact)
COPY . .
# NEXT_PUBLIC_* vars are baked into the JS bundle at build time - must be ARGs.
# Server-only vars used during static pre-rendering (ISR) also need to be ARGs.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG YOUTUBE_API_KEY
ENV YOUTUBE_API_KEY=$YOUTUBE_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# In a monorepo standalone build, the output preserves the workspace path:
#   standalone/apps/web/server.js   ← entry point
#   standalone/apps/web/.next/      ← server chunks
#   standalone/node_modules/        ← traced deps
# Public and static must be placed at their workspace-relative paths too.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
