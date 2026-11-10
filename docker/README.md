# Backend Docker Image

## Overview

The backend Docker image is built using the **build-on-host pattern**. Heavy compilation (native module compilation, TypeScript transpilation, dependency installation) happens on the host machine. Docker only copies pre-built artifacts into a lightweight runtime image.

## Why Build on Host?

Building inside Docker requires compiling 12+ native C/C++ modules (better-sqlite3, keytar, isolated-vm, tree-sitter, @swc/core, etc.) and transpiling TypeScript backend code. On WSL2, this takes ~20 minutes per build with a 3-4 GB layer export.

Building on the host takes ~4 minutes, and the Docker image build then takes < 3 minutes (cold) or < 30 seconds (warm).

## Workflow

### 1. Host Build (Prerequisites)

Before building the Docker image, run these commands on your host:

```bash
# Install dependencies (yarn workspaces)
yarn install --immutable

# Build the backend (compiles TypeScript, bundles, native modules)
yarn build:backend
```

This produces:
- `packages/backend/dist/bundle.tar.gz` — compiled backend (20MB)
- `node_modules/` — all dependencies with native binaries (2.5GB)
- `packages/*/dist/` — compiled plugin code

### 2. Docker Build

Once host artifacts are ready, build the image:

```bash
DOCKER_BUILDKIT=1 docker build \
  --file docker/Dockerfile.backend \
  -t platform_cloudhub-backend:latest \
  .
```

Or use the convenience script:

```bash
make docker-backend
```

Or the npm script:

```bash
yarn docker:backend
```

### 3. Runtime Execution

Start the containers:

```bash
docker compose up -d
```

The backend initializes plugins and becomes ready for requests.

## Build Times

| Scenario | Before | After | Speedup |
|----------|--------|-------|---------|
| Cold build | ~20 min | ~3 min | 6.7x |
| Warm build | ~20 min | ~30 sec | 40x |
| Image size | 3-4 GB | 3.4 GB | Similar |

*Warm = no changes to source files, using cached layers*

## Layer Strategy

The new Dockerfile uses these layers:

1. **Base image** (docker.io/library/node:22-bookworm-slim) — 250 MB
2. **Runtime system libs** (curl, ca-certificates, libsqlite3, libsecret) — 50 MB
3. **Metadata** (package.json, yarn.lock, .yarnrc.yml) — < 1 MB
4. **Plugins directory** — 30 MB (source + built artifacts)
5. **Packages directory** (frontend source, backend dist, cli) — 200 MB
6. **Pre-built node_modules** (from host) — 2.5 GB layer, cached by BuildKit
7. **Bundle extraction** + config + catalog assets — 200 MB

The node_modules layer uses BuildKit's layer caching, so warm builds skip this large copy.

## CI/CD Integration

Any CI pipeline that builds the backend Docker image must run the host build first:

```yaml
# GitHub Actions example
- name: Install dependencies
  run: yarn install --immutable

- name: Build backend
  run: yarn build:backend

- name: Build Docker image
  run: |
    DOCKER_BUILDKIT=1 docker build \
      --file docker/Dockerfile.backend \
      -t platform_cloudhub-backend:${{ github.sha }} \
      .
```

## Troubleshooting

### Backend fails to start after Docker build

**Symptom:** "Cannot find module" error for plugins

**Cause:** Host build was skipped. The image copies pre-built artifacts that don't exist.

**Fix:**
```bash
yarn install --immutable
yarn build:backend
docker build -f docker/Dockerfile.backend -t platform_cloudhub-backend:latest .
```

### Image size is still 3+ GB

**Expected.** The node_modules layer alone is 2.5 GB because:
- 12 native modules (*.node files)
- Backstage framework + plugins
- All runtime dependencies

To reduce: Consider using `node_modules` optimizations (remove source maps, trim unused packages at build time).

### Docker build takes longer than expected

**Check:**
- Is the context transfer slow? (docker build transfers ~2GB including node_modules)
  - On WSL2 with slow I/O, this can take 5+ min.
  - On Linux with SSD, this takes ~1 min.
- Is the node_modules COPY layer slow?
  - With BuildKit caching enabled, warm builds skip this.
  - Cold builds on WSL2 can take 5+ min for the 2.5 GB copy.

**Optimize:**
- Use BuildKit: `export DOCKER_BUILDKIT=1`
- Use a fast filesystem (WSL2 native ext4, not Windows NTFS mount)
- Run on Linux (fastest)

## Files Modified

- `docker/Dockerfile.backend` — build-on-host pattern (removed multi-stage build)
- `.dockerignore` — excludes dev files but includes pre-built artifacts
- `Makefile` — added `docker-backend` and `docker-backend-clean` targets
- `package.json` — added `docker:backend` script (if not using Makefile)

## Rollback

If the new Dockerfile causes issues:

```bash
cp docker/Dockerfile.backend.old docker/Dockerfile.backend
docker build -f docker/Dockerfile.backend -t platform_cloudhub-backend:latest .
```

The old multi-stage Dockerfile is fully functional (just slower).
