# ---------------------------------------
# Stage 1: Build & Deploy
# ---------------------------------------
# The exact image by digest, so every build starts from the same one; Dependabot moves both
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS builder
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
COPY production/package.json production/tsconfig.json ./production/

# Fetch deps — node-linker=hoisted ensures @mes/* resolve from any directory
RUN echo "node-linker=hoisted" > .npmrc && pnpm install --frozen-lockfile

# Copy full source
COPY packages/ ./packages/
COPY production/ ./production/

# Build the production service through its own TS project graph.
# This pulls in only the referenced workspace packages instead of the root graph.
RUN pnpm --filter production-service exec tsc -b tsconfig.json

# Deploy the versions pnpm-lock.yaml pins (including workspace dependencies)
# into a clean "/prod/production" folder. This completely isolates the service.
RUN pnpm --filter=production-service --prod deploy /prod/production

# Copy i18n translation files (outside dist, referenced via relative path from loaders)
RUN cp -r production/locales /prod/production/locales

# ---------------------------------------
# Stage 2: Runner (Production Image)
# ---------------------------------------
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS runner
RUN apk add --no-cache dumb-init

WORKDIR /app

# IMPORTANT: Set NODE_ENV to production
ENV NODE_ENV=production
ENV PORT=3002

# Copy the completely isolated result from the deploy step
COPY --from=builder /prod/production ./

# Create log directories required by business logic
RUN mkdir -p /app/logs && chown node:node /app/logs

# Security: Run as non-root user
USER node

EXPOSE 3002
CMD ["dumb-init", "node", "dist/app.js"]
