# ---------------------------------------
# Stage 1: Build & Deploy
# ---------------------------------------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat git openssh-client && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Ensure pnpm is available (must match packageManager in package.json)
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

WORKDIR /app

# Copy lockfile and configs first for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.app.json tsconfig.json ./
# Copy workspace package.jsons + tsconfigs to leverage cached installs
COPY packages/auth/package.json packages/auth/tsconfig.json ./packages/auth/
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/logger/package.json packages/logger/tsconfig.json ./packages/logger/
COPY packages/cache/package.json packages/cache/tsconfig.json ./packages/cache/
COPY packages/openapi/package.json packages/openapi/tsconfig.json ./packages/openapi/
COPY packages/health/package.json packages/health/tsconfig.json ./packages/health/
COPY packages/testing/package.json packages/testing/tsconfig.json ./packages/testing/
COPY user/package.json user/tsconfig.json ./user/

# Fetch deps — node-linker=hoisted ensures @mes/* resolve from any directory
RUN echo "node-linker=hoisted" > .npmrc && pnpm install --frozen-lockfile

# Copy full source
COPY packages/ ./packages/
COPY user/ ./user/

# 1. Build shared packages via project references (tsc -b handles order)
# 2. Build user service (resolves @mes/* from packages/*/dist/)
RUN pnpm build

# Copy i18n JSON translation files to dist since tsc does not bundle them
RUN mkdir -p user/dist/utils/lang && cp -r user/src/utils/lang/* user/dist/utils/lang/

# Magically deploy the exact dependencies (including workspace dependencies)
# into a clean "/prod/user" folder. This completely isolates the service.
RUN pnpm --filter=user-service --prod deploy --legacy /prod/user

# ---------------------------------------
# Stage 2: Runner (Production Image)
# ---------------------------------------
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init

WORKDIR /app

# IMPORTANT: Set NODE_ENV to production
ENV NODE_ENV=production
ENV PORT=3000

# Copy the completely isolated result from the deploy step
COPY --from=builder /prod/user ./

# Create log / upload directories required by business logic
RUN mkdir -p /app/logs /app/uploads && chown node:node /app/logs /app/uploads

# Security: Run as non-root user
USER node

EXPOSE 3000
CMD ["dumb-init", "node", "dist/app.js"]
