# CloudHub Docker Build Workflow

Local container lifecycle is intentionally reduced to a small set of bash commands.

## Canonical Commands

Start hot-reload local development (no image rebuild for source edits):

```bash
./scripts/dev.sh
```

Rebuild everything from local source and start all containers:

```bash
./scripts/rebuild.sh
```

Restart all containers without rebuilding images:

```bash
./scripts/restart.sh
```

## PowerShell Equivalents

```powershell
.\scripts\rebuild.ps1 frontend
.\scripts\rebuild.ps1 backend
.\scripts\rebuild.ps1 all
.\scripts\rebuild.ps1 refresh
```

## Build Optimization Notes

- `./scripts/rebuild.sh` does a clean rebuild (`docker compose build --pull --no-cache`) to guarantee containers reflect current local code.
- `./scripts/restart.sh` does not rebuild images; it recreates containers from already-built images.
- `./scripts/dev.sh` runs Backstage watch mode on local source with PostgreSQL in Docker, so page reload picks up edits without rebuilding images.
- `docker/Dockerfile.frontend` installs dependencies before copying the full source tree.
- `docker/Dockerfile.backend` already follows a manifest-first dependency install strategy.

## Optional Shared Base Image

`docker/Dockerfile.base` is provided as an optional common Node base stage (`node:22-bookworm-slim` + `corepack enable`).
Current frontend/backend Dockerfiles stay independently buildable with their service-specific optimization paths.
