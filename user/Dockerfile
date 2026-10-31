# ---------------------------------------
# Stage 1: Build & Deploy
# ---------------------------------------
FROM node:26-alpine AS builder
RUN apk add --no-cache libc6-compat git openssh-client && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Ensure pnpm is available (must match packageManager in package.json); Node 25+ ships no Corepack
RUN npm install -g pnpm@10.34.8

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
COPY user/package.json user/tsconfig.json ./user/

# Fetch deps — node-linker=hoisted ensures @mes/* resolve from any directory
RUN echo "node-linker=hoisted" > .npmrc && pnpm install --frozen-lockfile

# Copy full source
COPY packages/ ./packages/
COPY user/ ./user/

# Build the user service through its own TS project graph.
# This avoids unrelated root-level project references during image builds.
RUN pnpm --filter user-service exec tsc -b tsconfig.json

# Copy i18n JSON translation files to dist since tsc does not bundle them
RUN mkdir -p user/dist/utils/lang && cp -r user/src/utils/lang/* user/dist/utils/lang/

# Deploy the versions pnpm-lock.yaml pins (including workspace dependencies)
# into a clean "/prod/user" folder. This completely isolates the service.
RUN pnpm --filter=user-service --prod deploy /prod/user

# ---------------------------------------
# Stage 2: Runner (Production Image)
# ---------------------------------------
FROM node:26-alpine AS runner
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
