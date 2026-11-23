FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@9.0.0 turbo@2.10.11
WORKDIR /app
COPY . .
RUN turbo prune api --docker

FROM node:22-alpine AS installer
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@9.0.0 turbo@2.10.11
WORKDIR /app

# First install dependencies (as they change less often)
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/out/full/packages/database/prisma ./packages/database/prisma
COPY --from=builder /app/out/full/packages/database/prisma.config.ts ./packages/database/prisma.config.ts
RUN pnpm install --frozen-lockfile

# Build the project and its dependencies
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN pnpm turbo run build --filter=api

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 api
RUN mkdir -p /var/lib/vaultfs && chown api:nodejs /var/lib/vaultfs
USER api

# Copy the entire monorepo from the installer stage (with built assets and node_modules)
COPY --from=installer --chown=api:nodejs /app .

EXPOSE 4000
ENV PORT=4000

WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "dist/index.cjs"]
