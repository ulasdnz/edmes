# ---------------------------------------
# Stage 1: Build & Deploy
# ---------------------------------------
# The exact image by digest, so every build starts from the same one; Dependabot moves both
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS builder
RUN apk add --no-cache libc6-compat git openssh-client && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

RUN npm install -g pnpm@10.34.8

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.app.json tsconfig.json ./
COPY packages/auth/package.json packages/auth/tsconfig.json ./packages/auth/
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/logger/package.json packages/logger/tsconfig.json ./packages/logger/
COPY packages/cache/package.json packages/cache/tsconfig.json ./packages/cache/
COPY packages/openapi/package.json packages/openapi/tsconfig.json ./packages/openapi/
COPY packages/events/package.json packages/events/tsconfig.json ./packages/events/
COPY packages/health/package.json packages/health/tsconfig.json ./packages/health/
COPY packages/testing/package.json packages/testing/tsconfig.json ./packages/testing/
COPY packages/privileges/package.json packages/privileges/tsconfig.json ./packages/privileges/
COPY telemetry/package.json telemetry/tsconfig.json ./telemetry/

RUN echo "node-linker=hoisted" > .npmrc && pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY telemetry/ ./telemetry/

# Build only telemetry's project graph. The root graph can reference services
# that are intentionally not copied into this image.
RUN pnpm --filter telemetry-service exec tsc -b tsconfig.json

RUN mkdir -p telemetry/dist/utils/lang && cp -r telemetry/src/utils/lang/* telemetry/dist/utils/lang/

RUN pnpm --filter=telemetry-service --prod deploy /prod/telemetry

# ---------------------------------------
# Stage 2: Runner (Production Image)
# ---------------------------------------
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS runner
RUN apk add --no-cache dumb-init

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /prod/telemetry ./

RUN mkdir -p /app/logs && chown node:node /app/logs

USER node

EXPOSE 3001
CMD ["dumb-init", "node", "dist/app.js"]
