# CloudHub Container Architecture

This document describes all containers required to run the CloudHub platform locally and in production environments.

## Overview

CloudHub uses a **containerized architecture** with three core containers:

1. **Frontend** — Nginx-based React application (port 3000)
2. **Backend** — Node.js Backstage server (port 7007)
3. **PostgreSQL** — Database (port 5432/5433 local)

---

## Core Containers

### 1. Frontend Container

**Purpose:** Serves the CloudHub web application UI

**Docker Image:** `platform_cloudhub-frontend` (local build)

**Base Image:** `nginx:alpine`

**Dockerfile:** [docker/Dockerfile.frontend](../docker/Dockerfile.frontend)

**Ports:**

- Local development: `3000` (HTTP)
- Production (Azure): `443` (HTTPS, via App Service)

**Key Environment Variables:**
| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKEND_ORIGIN` | `http://backend:7007` | Backend URL for nginx reverse proxy |

**Features:**

- ✅ Multi-stage build (Node.js build stage, nginx runtime stage)
- ✅ Nginx reverse proxy routing `/api/*` to backend
- ✅ Environment variable substitution via `envsubst` templates
- ✅ Alpine Linux base (lightweight, security-focused)

**Build Stages:**

1. **Build Stage (Node.js 22):** Compiles React app with Yarn
2. **Runtime Stage (Nginx Alpine):** Serves compiled app

**Deployment:**

- **Local:** Docker Compose via `docker-compose.yml`
- **Production:** Azure App Service container instance
- **Registry:** ACR (`symphonyfs`)

**Configuration Files:**

- `docker/nginx.conf.template` — Nginx configuration with environment variable substitution

**Health Check:**

- HTTP GET to `/` (returns HTML status code)
- Production: Azure App Service built-in health probing

---

### 2. Backend Container

**Purpose:** Runs the Backstage backend server with CloudHub plugins

**Docker Image:** `platform_cloudhub-backend` (local build)

**Base Image:** `node:22-bookworm-slim`

**Dockerfile:** [docker/Dockerfile.backend](../docker/Dockerfile.backend)

**Ports:**

- Local development: `7007` (HTTP)
- Production (Azure): `7007` (HTTP via private network or App Service)

**Key Environment Variables:**
| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `POSTGRES_HOST` | Yes | `postgres` | PostgreSQL server hostname |
| `POSTGRES_PORT` | Yes | `5432` | PostgreSQL port |
| `POSTGRES_USER` | Yes | `backstage` | Database username |
| `POSTGRES_PASSWORD` | Yes | `backstage` | Database password |
| `POSTGRES_DB` | No | `backstage` | Database name |
| `NODE_ENV` | No | `production` | Node environment |
| `AUTH_MICROSOFT_CLIENT_ID` | No | — | Microsoft Entra ID app registration client ID |
| `AUTH_MICROSOFT_CLIENT_SECRET` | No | — | Microsoft Entra ID app registration client secret |
| `AUTH_MICROSOFT_TENANT_ID` | No | — | Microsoft Entra ID tenant ID |
| `GPU_ENTRA_GROUP_ID` | No | — | Entra group object id required for GPU Compute visibility and access |
| `COST_AUTOMATION_STORAGE_CONNECTION_STRING` | No | `UseDevelopmentStorage=true` | Azure Storage connection string (local dev uses Azurite) |

GitHub deploy workflows in this repository are image-tag driven. The old `GITHUB_DIRECT_DEPLOY` toggle is kept only as a legacy compatibility flag in local `.env` files and is not consumed by any in-repo workflow.

**Features:**

- ✅ Multi-stage build (Node.js build, node runtime)
- ✅ Yarn workspaces for monorepo dependencies
- ✅ Backstage core with CloudHub plugins
- ✅ PostgreSQL database connection (production)
- ✅ Microsoft Entra ID authentication
- ✅ Azure Storage integration
- ✅ Built-in health check endpoints

**Build Stages:**

1. **Build Stage:** Installs dependencies, builds backend
2. **Runtime Stage:** Lean runtime with only necessary dependencies

**Health Check Endpoints:**

- `GET /.backstage/health/v1/readiness` — Ready to accept requests
- `GET /.backstage/health/v1/liveness` — Process alive
- Response: `{ status: 'ok' }`

**Deployment:**

- **Local:** Docker Compose via `docker-compose.yml`
- **Production:** Azure App Service container instance
- **Registry:** ACR (`symphonyfs`)

**Startup Command:**

```bash
node packages/backend --config app-config.yaml --config app-config.production.yaml
```

---

### 3. PostgreSQL Container

**Purpose:** Provides persistent data storage for Backstage

**Docker Image:** `postgres:16-alpine`

**Source:** Official PostgreSQL image from Docker Hub

**Dockerfile:** N/A (pulled from registry)

**Ports:**

- Local development: `5433` → `5432` (mapped to avoid conflicts)
- Production (Azure): `5432` via Azure Database for PostgreSQL

**Key Environment Variables:**
| Variable | Value | Purpose |
|----------|-------|---------|
| `POSTGRES_USER` | `backstage` | Default database user |
| `POSTGRES_PASSWORD` | `backstage` | Default user password |
| `POSTGRES_DB` | `backstage` | Default database name |
| `LANG` | `C.UTF-8` | Locale setting |

**Features:**

- ✅ Alpine Linux base (lightweight)
- ✅ PostgreSQL 16 (latest stable)
- ✅ Custom startup command with optimized logging
- ✅ Health checks via `pg_isready`
- ✅ Persistent volume for data (`pgdata`)
- ✅ Graceful shutdown (SIGTERM)

**Health Check:**

- Command: `pg_isready -U backstage`
- Interval: 10 seconds
- Timeout: 5 seconds
- Retries: 5
- Start period: 20 seconds

**Volume Mounts:**

- `/var/lib/postgresql/data` → `pgdata` volume (persists database files)

**Deployment:**

- **Local:** Docker Compose container
- **Production:** Azure Database for PostgreSQL (managed service)

**Configuration:**

```bash
postgres -c log_checkpoints=off \
         -c log_autovacuum_min_duration=-1 \
         -c log_min_messages=WARNING \
         -c log_min_error_statement=ERROR
```

---

## Container Networking & Orchestration

### Docker Compose (Local Development)

**File:** [docker-compose.yml](../docker-compose.yml)

**Network:** `bridge` (default docker compose network)

**Service Dependency Graph:**

```
frontend:3000
    ↓ depends_on (condition: service_started)
backend:7007
    ↓ depends_on (condition: service_healthy)
postgres:5432
```

**Port Mappings:**
| Service | Container Port | Host Port | Protocol |
|---------|----------------|-----------|----------|
| Frontend | `80` | `3000` | HTTP |
| Backend | `7007` | `7007` | HTTP |
| PostgreSQL | `5432` | `5433` | TCP |

**Startup Sequence:**

1. PostgreSQL starts and waits for health check
2. Backend starts after PostgreSQL is healthy
3. Frontend starts after backend is started
4. All services available on `localhost:PORT`

**Running Locally:**

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Remove volumes (WARNING: deletes database)
docker-compose down -v
```

### Kubernetes / Azure App Service (Production)

**Frontend Deployment:**

- Container Registry: ACR (`symphonyfs.azurecr.io`)
- Image Repository: `cloudhub-platform/frontend`
- App Service: `cloudhub-frontend`
- Resource Group: `rg-cfe-apps-mj`

**Backend Deployment:**

- Container Registry: ACR (same as frontend)
- Image Repository: `cloudhub-platform/backend`
- App Service: `cloudhub-backend`
- Resource Group: `rg-cfe-apps-mj`

**Database:**

- Type: Azure Database for PostgreSQL
- Hostname: `cloudhub-pg-sdc.postgres.database.azure.com` (configurable)
- Port: `5432`
- TLS Required: Yes

---

## Base Images Reference

### Node.js 22 Slim (Frontend & Backend)

**Image:** `node:22-bookworm-slim`

**Purpose:** Build and runtime base for JavaScript/TypeScript applications

**Size:** ~150 MB (slim variant)

**Includes:**

- Node.js 22 (LTS)
- npm 10
- Python 3 (for native modules)
- Build tools (g++, make)
- Yarn package manager

**Variants:**

- `-slim`: Minimal, reduced dependencies (used here)
- `-full`: Includes more build tools
- `-alpine`: Even smaller but less compatible

### Nginx Alpine

**Image:** `nginx:alpine`

**Purpose:** Lightweight web server for frontend

**Size:** ~10 MB

**Features:**

- Nginx 1.27+
- Alpine Linux 3.x
- Minimal, security-focused
- Small attack surface

### PostgreSQL Alpine

**Image:** `postgres:16-alpine`

**Purpose:** Reliable, production-grade SQL database

**Size:** ~100 MB

**Features:**

- PostgreSQL 16 (stable)
- Alpine Linux
- Built-in replication support
- ACID compliance

---

## Container Registry (ACR)

### Azure Container Registry

**Purpose:** Centralized repository for built and pushed container images

**Registry Used:**

- **Default (all CI/CD workflows):** `symphonyfs.azurecr.io`
  - For build workflows
  - For release/deploy workflows

**Repository Structure:**

```
<registry>/cloudhub-platform/frontend:<tag>
<registry>/cloudhub-platform/backend:<tag>
```

**Image Tags:**

- Semantic versioning: `1.0.0`, `2.1.3`
- Date-based: `2026-08-01`
- Build numbers: `build-123`
- `latest` — Most recent stable

**Authentication:**

- Service Principal (SPN) with ACR push/pull permissions
- Credentials stored in GitHub Secrets
- Used in GitHub Actions workflows for push/pull

---

## Docker Images by Deployment Method

### Local Development (docker-compose)

**Images Built:**

```dockerfile
# Frontend
docker build -t platform_cloudhub-frontend -f docker/Dockerfile.frontend .

# Backend
docker build -t platform_cloudhub-backend -f docker/Dockerfile.backend .
```

**Images Pulled:**

```dockerfile
postgres:16-alpine
```

**Network:** Bridge network created by docker-compose

**Storage:** Persistent volume `pgdata` for PostgreSQL

### Production (Azure App Service)

**Images Source:** ACR (Azure Container Registry)

**Frontend Image:**

```
symphonyfs.azurecr.io/cloudhub-platform/frontend:v1.0.0
```

**Backend Image:**

```
symphonyfs.azurecr.io/cloudhub-platform/backend:v1.0.0
```

**Database:** Azure Database for PostgreSQL (managed service, not containerized)

**Deployment:** Azure Container Instances (via App Service)

---

## Container Configuration Summary

| Aspect           | Frontend          | Backend                                    | PostgreSQL                        |
| ---------------- | ----------------- | ------------------------------------------ | --------------------------------- |
| **Image**        | `nginx:alpine`    | `node:22-bookworm-slim`                    | `postgres:16-alpine`              |
| **Local Port**   | 3000              | 7007                                       | 5433→5432                         |
| **Prod Port**    | 443 (App Service) | 7007                                       | 5432 (Azure DB)                   |
| **Volume**       | None              | None                                       | `pgdata:/var/lib/postgresql/data` |
| **Health Check** | HTTP GET `/`      | HTTP GET `/.backstage/health/v1/readiness` | `pg_isready -U backstage`         |
| **Startup Deps** | Waits for backend | Waits for PostgreSQL                       | None                              |
| **Env Config**   | `BACKEND_ORIGIN`  | 9 variables (DB, auth)                     | 4 variables (credentials)         |

---

## Building Custom Images

### Build Frontend Image

```bash
docker build -t cloudhub-platform/frontend:latest \
  -f docker/Dockerfile.frontend \
  --progress=plain \
  .
```

### Build Backend Image

```bash
docker build -t cloudhub-platform/backend:latest \
  -f docker/Dockerfile.backend \
  --progress=plain \
  .
```

### Push to ACR

```bash
# Login to ACR
az acr login --name symphonyfs

# Tag image
docker tag cloudhub-platform/backend:latest \
  symphonyfs.azurecr.io/cloudhub-platform/backend:v1.0.0

# Push image
docker push symphonyfs.azurecr.io/cloudhub-platform/backend:v1.0.0
```

---

## Troubleshooting Containers

### Check Running Containers

```bash
# Local
docker-compose ps

# Inspect logs
docker-compose logs backend
docker-compose logs frontend
docker-compose logs postgres
```

### Database Connection Issues

```bash
# Test PostgreSQL connectivity
docker-compose exec backend psql -h postgres -U backstage -d backstage -c "select 1"

# Check PostgreSQL logs
docker-compose logs postgres
```

### Frontend not reaching Backend

**Issue:** Frontend returns 502 or connection refused

**Solutions:**

1. Verify `BACKEND_ORIGIN` environment variable
2. Check backend is healthy: `curl http://localhost:7007/.backstage/health/v1/readiness`
3. Ensure Docker network allows communication
4. Check firewall rules (production)

### Backend won't start

**Issue:** "Connection refused" or "pg_isready failed"

**Solutions:**

1. Ensure PostgreSQL is running and healthy
2. Verify credentials: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
3. Check PostgreSQL logs: `docker-compose logs postgres`
4. Verify environment file `.env` is loaded correctly

---

## Production Considerations

### Image Security

- ✅ Use slim/alpine variants (minimal surface area)
- ✅ Regular base image updates (Node.js, nginx, PostgreSQL)
- ✅ Scan images for vulnerabilities: `az acr scan`
- ✅ Enable Docker Content Trust for signed images
- ✅ Use private ACR (not public registry)

### Image Size

- Frontend: ~200-300 MB (nginx + compiled React)
- Backend: ~800-1000 MB (Node.js + dependencies)
- PostgreSQL: ~100 MB (pulled from registry)

### Performance

- Use multi-stage builds (reduces final image size)
- Cache Docker layers effectively
- Pull images from nearby ACR endpoints
- Consider ACR geo-replication for global deployments

### Cost Optimization

- ACR Standard tier for single region
- ACR Premium tier for geo-replication
- Clean up unused images regularly
- Use lifecycle management policies

---

## Related Documentation

- [GitHub Actions Workflows](./github-actions-deployment-workflows.md)
- [Container Release Process](./container-release-process.md)
- [Docker Build Workflow](./docker-build-workflow.md)
- [docker-compose.yml](../docker-compose.yml)
- [Dockerfile.frontend](../docker/Dockerfile.frontend)
- [Dockerfile.backend](../docker/Dockerfile.backend)
