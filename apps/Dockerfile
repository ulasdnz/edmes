# ---------------------------------------
# Stage 1: Build both frontends
# ---------------------------------------
# The same Node image as the services, by digest; Dependabot moves both
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS builder

# Must match packageManager in package.json; Node 25+ ships no Corepack
RUN npm install -g pnpm@10.34.8

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.web.json ./
# Workspace package.jsons first, so the install layer is cached until a dependency changes
COPY apps/package.json ./apps/
COPY apps/web/package.json ./apps/web/
COPY apps/operator/package.json ./apps/operator/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/ui/package.json ./packages/ui/
COPY packages/privileges/package.json ./packages/privileges/

RUN pnpm install --frozen-lockfile --filter web-app... --filter operator-panel...

COPY packages/api-client/ ./packages/api-client/
COPY packages/frontend/ ./packages/frontend/
COPY packages/ui/ ./packages/ui/
COPY packages/privileges/ ./packages/privileges/
COPY apps/ ./apps/

# The only value compiled in; it shows in the app and in version.json
ARG EDMES_VERSION=dev
ENV EDMES_VERSION=$EDMES_VERSION
RUN pnpm --filter web-app build && pnpm --filter operator-panel build

# ---------------------------------------
# Stage 2: Runner
# ---------------------------------------
FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03 AS runner

COPY apps/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/security-headers.conf /etc/nginx/edmes/security-headers.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY --from=builder /app/apps/operator/dist /usr/share/nginx/html/operator

EXPOSE 8080
