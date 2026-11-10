# CloudHub Technology Stack

This document summarizes the technologies currently configured in this repository for the CloudHub developer portal, its supporting services, and its delivery workflows. It is based on the checked-in manifests and configuration; optional workload chart components are identified separately from the portal runtime.

## At a glance

| Area | Technology | Repository evidence |
|---|---|---|
| Developer portal | Backstage 1.55.2, React 18, TypeScript, React Router 6, Material UI 5 | [backstage.json](../backstage.json), [packages/app/package.json](../packages/app/package.json) |
| Backend | Backstage backend, Node.js, TypeScript; Express-based HTTP services | [packages/backend/src/index.ts](../packages/backend/src/index.ts), [packages/backend/package.json](../packages/backend/package.json) |
| Package management | Yarn 4.18.1 workspaces | [package.json](../package.json) |
| Primary database | PostgreSQL (`pg` client); PostgreSQL 16 in local Compose | [app-config.yaml](../app-config.yaml), [docker-compose.yml](../docker-compose.yml) |
| Identity | Microsoft Entra ID sign-in; Microsoft Graph organization catalog | [packages/backend/src/index.ts](../packages/backend/src/index.ts), [app-config.yaml](../app-config.yaml) |
| Cloud and orchestration | Microsoft Azure, Azure Kubernetes Service (AKS), Kubernetes, Helm | [charts/](../charts/), [deployments/](../deployments/), [azure-functions/aks-scheduler/](../azure-functions/aks-scheduler/) |
| Containers and web serving | Docker; nginx serves the built frontend and proxies backend requests | [docker/Dockerfile.frontend](../docker/Dockerfile.frontend), [docker/Dockerfile.backend](../docker/Dockerfile.backend), [docker/nginx.conf.template](../docker/nginx.conf.template) |
| CI and quality | GitHub Actions, Jest, Playwright, TypeScript, ESLint, Prettier | [package.json](../package.json), [ci-quality-gate.yml](../.github/workflows/ci-quality-gate.yml) |

## Portal and backend

CloudHub is organized as a Backstage monorepo. The frontend is a React single-page application using Backstage's frontend system, React Router, and Material UI. It includes standard Backstage experiences such as the software catalog, scaffolder, TechDocs, Kubernetes, and search, alongside internal CloudHub plugins.

The backend uses Backstage's modular backend and registers authentication, catalog, scaffolder, TechDocs, permissions, Kubernetes, and optional search modules, as well as CloudHub-specific provisioning, cost automation, health-check, tenant-registry, deployment-control-plane, and platform-registry functionality. Its HTTP services run in the Node.js backend process.

The root package manifest allows Node.js 22 or 24. The container images use Node.js 22; the quality-gate workflow uses Node.js 24. Backstage's repository version is recorded as 1.55.2. Yarn 4.18.1 manages the root workspace packages and plugins.

Evidence: [backstage.json](../backstage.json), [package.json](../package.json), [packages/app/package.json](../packages/app/package.json), [packages/backend/src/index.ts](../packages/backend/src/index.ts).

## Data and identity

- **PostgreSQL** is the configured Backstage database client. The local Compose environment runs PostgreSQL 16; environment-specific connection details are supplied through configuration and environment variables.
- **Microsoft Entra ID** is the configured sign-in provider. The backend registers the Microsoft provider with a CloudHub sign-in resolver; GitHub OAuth sign-in is intentionally not registered.
- **Microsoft Graph** is used by the catalog organization module to synchronize organization data.
- **Azure Table Storage** is used by the cost-automation integration when configured. It is not the primary Backstage database.
- **GitHub integration** supports repository and workflow-related features, including the Backstage GitHub scaffolder module and Octokit-based plugin functionality. This is distinct from user authentication.

Evidence: [app-config.yaml](../app-config.yaml), [app-config.production.yaml](../app-config.production.yaml), [packages/backend/src/index.ts](../packages/backend/src/index.ts), [packages/backend/src/tableStorageWriter.ts](../packages/backend/src/tableStorageWriter.ts).

## Azure services, containers, and workloads

The repository integrates with Microsoft Azure services and includes an Azure Functions v4, Node.js/TypeScript AKS scheduler. The scheduler reads schedules from the Backstage API and calls Azure Resource Manager APIs through Azure SDK packages.

Docker Compose defines a local frontend, backend, and PostgreSQL setup. The frontend image builds the Backstage app and serves its static output with nginx; nginx proxies backend requests. The backend is packaged as a Node.js container. GitHub Actions workflows provide quality gates and image/deployment automation, including Azure-oriented workflows. Helm charts and deployment definitions in the repository support Kubernetes/AKS workloads.

The chart tree also contains optional service charts, including Kafka and MinIO. Their presence describes deployment capabilities, not a guarantee that every service is enabled in every environment.

Evidence: [docker-compose.yml](../docker-compose.yml), [docker/Dockerfile.frontend](../docker/Dockerfile.frontend), [docker/Dockerfile.backend](../docker/Dockerfile.backend), [azure-functions/aks-scheduler/package.json](../azure-functions/aks-scheduler/package.json), [azure-functions/aks-scheduler/src/SchedulerFunction/index.ts](../azure-functions/aks-scheduler/src/SchedulerFunction/index.ts), [charts/](../charts/), [deployments/](../deployments/).

## Build, testing, and documentation

- **Build and development:** Backstage CLI, Yarn workspaces, and TypeScript. The root TypeScript version is 5.8.3.
- **Testing:** Jest for unit and integration tests; Playwright for browser end-to-end tests; React Testing Library for UI tests; Supertest is available for HTTP/API tests.
- **Quality checks:** ESLint, Prettier, and TypeScript checks. The GitHub Actions quality gate installs dependencies immutably and runs lint, typecheck, test coverage, and platform validation.
- **Documentation:** Markdown documentation is maintained in `docs/`; Backstage TechDocs is registered in the backend and configured in `app-config.yaml`.

Evidence: [package.json](../package.json), [packages/app/package.json](../packages/app/package.json), [packages/backend/package.json](../packages/backend/package.json), [ci-quality-gate.yml](../.github/workflows/ci-quality-gate.yml), [app-config.yaml](../app-config.yaml).

## Main repository areas

| Path | Responsibility |
|---|---|
| `packages/app/` | Backstage frontend application |
| `packages/backend/` | Backstage backend application and backend modules |
| `plugins/` | CloudHub frontend and backend plugins |
| `azure-functions/aks-scheduler/` | Azure Functions scheduler for AKS operations |
| `charts/` and `deployments/` | Helm charts and deployment definitions |
| `docker/` | Frontend/backend Dockerfiles and nginx configuration |
| `.github/workflows/` | CI, image build, and deployment workflows |

For the authoritative versions and enabled features, consult the manifests and environment-specific configuration linked above; this overview may need updating as those files change.
