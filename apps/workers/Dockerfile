# Build context must be the monorepo root: docker build -f apps/workers/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/database/package.json ./packages/database/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN pnpm install --frozen-lockfile
COPY packages/database/prisma ./packages/database/prisma
COPY packages/database/prisma.config.ts ./packages/database/prisma.config.ts
RUN pnpm --filter @repo/database run db:generate

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 workers

COPY --from=deps --chown=workers:nodejs /app/node_modules ./node_modules
# pnpm v9 puts workspace package binaries in their own node_modules, not root
COPY --from=deps --chown=workers:nodejs /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=deps --chown=workers:nodejs /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps --chown=workers:nodejs /app/packages/database/generated ./packages/database/generated
COPY --chown=workers:nodejs packages/database/package.json ./packages/database/package.json
COPY --chown=workers:nodejs packages/database/src ./packages/database/src
COPY --chown=workers:nodejs apps/workers/src ./apps/workers/src

USER workers

CMD ["apps/workers/node_modules/.bin/tsx", "apps/workers/src/index.ts"]
