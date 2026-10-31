# ---------------------------------------
# Stage 1: Build & Deploy
# ---------------------------------------
FROM node:26-alpine AS builder
RUN apk add --no-cache libc6-compat git openssh-client && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

RUN npm install -g pnpm@10.34.8

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.app.json tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/logger/package.json packages/logger/tsconfig.json ./packages/logger/
COPY packages/events/package.json packages/events/tsconfig.json ./packages/events/
COPY packages/health/package.json packages/health/tsconfig.json ./packages/health/
COPY packages/cache/package.json packages/cache/tsconfig.json ./packages/cache/
COPY packages/auth/package.json packages/auth/tsconfig.json ./packages/auth/
COPY packages/openapi/package.json packages/openapi/tsconfig.json ./packages/openapi/
COPY packages/testing/package.json packages/testing/tsconfig.json ./packages/testing/
COPY realtime/package.json realtime/tsconfig.json ./realtime/

RUN echo "node-linker=hoisted" > .npmrc && pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY realtime/ ./realtime/

RUN pnpm --filter realtime-service exec tsc -b tsconfig.json

RUN pnpm --filter=realtime-service --prod deploy /prod/realtime

# ---------------------------------------
# Stage 2: Runner (Production Image)
# ---------------------------------------
FROM node:26-alpine AS runner
RUN apk add --no-cache dumb-init

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3003

COPY --from=builder /prod/realtime ./

RUN mkdir -p /app/logs && chown node:node /app/logs

USER node

EXPOSE 3003
CMD ["dumb-init", "node", "dist/app.js"]
