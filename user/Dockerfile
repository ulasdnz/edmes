# ---------------------------------------
# Stage 1: Build & Deploy
# ---------------------------------------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat git openssh-client && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Ensure pnpm is available (lockfileVersion 6.x => pnpm v8)
RUN corepack enable && corepack prepare pnpm@8.12.0 --activate

WORKDIR /app

# Copy lockfile and configs first for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy workspace package.jsons to leverage cached installs
COPY packages/auth/package.json ./packages/auth/
COPY packages/core/package.json ./packages/core/
COPY packages/logger/package.json ./packages/logger/
COPY packages/cache/package.json ./packages/cache/
COPY packages/openapi/package.json ./packages/openapi/
COPY user/package.json ./user/

# Fetch deps
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Copy full source
COPY packages/ ./packages/
COPY user/ ./user/

# Build internal packages & the user service
RUN pnpm -r run build

# Copy i18n JSON translation files to dist since tsc does not bundle them
RUN mkdir -p user/dist/utils/lang && cp -r user/src/utils/lang/* user/dist/utils/lang/

# Magically deploy the exact dependencies (including workspace dependencies)
# into a clean "/prod/user" folder. This completely isolates the service.
RUN pnpm --filter=user-service --prod deploy /prod/user

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
