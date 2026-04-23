# ---------------------------------------
# Stage 1: Build & Deploy
# ---------------------------------------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat git openssh-client && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Ensure pnpm is available (must match packageManager in package.json)
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Copy lockfile and configs first for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.app.json tsconfig.json ./
# Copy workspace package.jsons + tsconfigs to leverage cached installs
COPY packages/auth/package.json packages/auth/tsconfig.json ./packages/auth/
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/logger/package.json packages/logger/tsconfig.json ./packages/logger/
COPY packages/cache/package.json packages/cache/tsconfig.json ./packages/cache/
COPY packages/openapi/package.json packages/openapi/tsconfig.json ./packages/openapi/
COPY packages/events/package.json packages/events/tsconfig.json ./packages/events/
COPY packages/health/package.json packages/health/tsconfig.json ./packages/health/
COPY packages/testing/package.json packages/testing/tsconfig.json ./packages/testing/
COPY packages/privileges/package.json packages/privileges/tsconfig.json ./packages/privileges/
COPY performance/package.json performance/tsconfig.json ./performance/

# Fetch deps — node-linker=hoisted ensures @mes/* resolve from any directory
RUN echo "node-linker=hoisted" > .npmrc && pnpm install --frozen-lockfile

# Copy full source
COPY packages/ ./packages/
COPY performance/ ./performance/

# Build the performance service through its own TS project graph.
# This pulls in only the referenced workspace packages instead of the root graph.
RUN pnpm --filter performance-service exec tsc -b tsconfig.json

# Magically deploy the exact dependencies (including workspace dependencies)
# into a clean "/prod/performance" folder. This completely isolates the service.
RUN pnpm --filter=performance-service --prod deploy --legacy /prod/performance

# Copy i18n translation files (outside dist, referenced via relative path from loaders)
RUN cp -r performance/locales /prod/performance/locales

# ---------------------------------------
# Stage 2: Runner (Production Image)
# ---------------------------------------
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init

WORKDIR /app

# IMPORTANT: Set NODE_ENV to production
ENV NODE_ENV=production
ENV PORT=3004

# Copy the completely isolated result from the deploy step
COPY --from=builder /prod/performance ./

# Create log directories required by business logic
RUN mkdir -p /app/logs && chown node:node /app/logs

# Security: Run as non-root user
USER node

EXPOSE 3004
CMD ["dumb-init", "node", "dist/app.js"]
