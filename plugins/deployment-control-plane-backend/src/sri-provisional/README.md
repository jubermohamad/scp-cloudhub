# SRI-Provisional Backend Integration

This directory contains the SRI-Provisional deployment engine integrated into CloudHub.

## Overview

SRI-Provisional is one of three available deployment backends in CloudHub:

1. **CloudHub Native** — GitHub Actions + Helmfile deployment
2. **Provisioner Pipeline** — FastAPI provisioner deployment
3. **SRI-Provisional** — SRI component catalog with provisioner

## Files

- `components.yaml` — SRI component definitions (investigation, detection, data, etc.)
  - Components define the applications that can be deployed
  - Each component has chart versions available
  - SKUs define resource allocations (standard, large, xlarge)

## Configuration

SRI-Provisional is disabled by default. To enable it:

```bash
export SRI_PROVISIONAL_ENABLED=true
```

When enabled, the service initializes a separate PostgreSQL database named `sri_provisional` with its own schema for managing deployments and components.

## Database

- **Database name**: `sri_provisional`
- **Connection**: Uses same PostgreSQL host as CloudHub, but different database
- **Credentials**: Uses same postgres user as CloudHub
- **Schema**: Includes tables for `sri_components`, `sri_deployments`, and `sri_skus`

## Architecture

SRI-Provisional deployments flow through CloudHub's existing approval workflow:

1. User selects SRI component in Deployment Wizard
2. Backend creates record in CloudHub database with `backend_source='sri-provisional'`
3. Deployment enters Pending Approvals workflow (shared with all backends)
4. Admin approves/rejects through the same UI
5. Upon approval, SRI-Provisional orchestration handler invokes provisioner
6. Provisioner webhook posts status updates back to CloudHub
7. Pending Approvals dashboard shows unified view of all deployments

## Phase Completion

This is **Phase 1: Foundation**. The infrastructure is in place but not yet active in the deployment workflow.

- **Phase 2**: Approval workflow integration
- **Phase 3**: Provisioner orchestration and status sync
