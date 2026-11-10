# Data Export Hub cluster agent.
#
# Build from the repository root (the Yarn 4 workspace root):
#   docker build -f services/data-export-agent/Dockerfile -t data-export-agent:dev .
#
# The runtime image holds only production dependencies and the compiled
# agent, runs as the non-root `node` user (uid 1000), and works with a
# read-only root filesystem: the only writable path it needs is WORK_DIR
# (default /work), which the Helm chart mounts as an emptyDir.

# ---------------------------------------------------------------------------
# Yarn metadata: root manifests plus this workspace's package.json only, so
# dependency layers are cached until a manifest or the lockfile changes.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml backstage.json ./
COPY .yarn ./.yarn
COPY services/data-export-agent/package.json services/data-export-agent/

# ---------------------------------------------------------------------------
# Compile TypeScript (needs the workspace's dev dependencies).
# ---------------------------------------------------------------------------
FROM base AS builder
RUN --mount=type=cache,target=/root/.yarn/berry/cache,sharing=locked \
    YARN_ENABLE_SCRIPTS=0 yarn workspaces focus @internal/data-export-agent
COPY services/data-export-agent/tsconfig.build.json services/data-export-agent/
COPY services/data-export-agent/src services/data-export-agent/src
RUN yarn workspace @internal/data-export-agent build

# ---------------------------------------------------------------------------
# Production dependencies only.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
ENV NODE_ENV=production
RUN --mount=type=cache,target=/root/.yarn/berry/cache,sharing=locked \
    yarn workspaces focus @internal/data-export-agent --production \
    && mkdir -p services/data-export-agent/node_modules

# ---------------------------------------------------------------------------
# Runtime.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    WORK_DIR=/work \
    HEALTH_PORT=8080
RUN apk add --no-cache ca-certificates \
    && mkdir -p /work \
    && chown node:node /work
WORKDIR /app
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=prod-deps --chown=root:root /app/services/data-export-agent/node_modules ./services/data-export-agent/node_modules
COPY --chown=root:root services/data-export-agent/package.json ./services/data-export-agent/
COPY --from=builder --chown=root:root /app/services/data-export-agent/dist ./services/data-export-agent/dist

# Code and dependencies are root-owned and read-only for the runtime user.
USER node
WORKDIR /app/services/data-export-agent
EXPOSE 8080
VOLUME ["/work"]
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
