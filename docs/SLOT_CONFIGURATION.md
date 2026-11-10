# App Service Slot Configuration

Create a `staging` slot for both `cloudhub-backend` and `cloudhub-frontend` before using the new release workflows.

```bash
az webapp deployment slot create -g rg-cfe-apps-mj -n cloudhub-backend --slot staging
az webapp deployment slot create -g rg-cfe-apps-mj -n cloudhub-frontend --slot staging
```

## Recommended slot settings

Mark a setting as a deployment slot setting when staging must not inherit the production value:

| Setting | Recommendation | Reason |
|---|---|---|
| `POSTGRES_HOST` | Slot-specific when staging uses a different database | Prevent staging from writing to production data |
| `POSTGRES_USER` | Slot-specific when staging credentials differ | Least privilege and environment separation |
| `POSTGRES_PASSWORD` | Slot-specific | Secret must never cross environments |
| `POSTGRES_DB` | Slot-specific when database differs | Avoid accidental production writes |
| `AUTH_MICROSOFT_CLIENT_SECRET` | Slot-specific | Separate Entra credential lifecycle |
| `AUTH_MICROSOFT_CLIENT_ID` | Slot-specific when app registrations differ | Correct callback and tenant configuration |
| `AUTH_MICROSOFT_TENANT_ID` | Slot-specific when tenants differ | Environment isolation |
| `APP_BASE_URL` | Slot-specific if staging has a distinct public URL | Correct OAuth callback and links |
| `BACKEND_BASE_URL` | Slot-specific | Backend self-reference must match the slot |
| `BACKEND_ORIGIN` | Slot-specific on frontend | Frontend must route to the intended backend |
| `APPINSIGHTS_CONNECTION_STRING` | Slot-specific when telemetry is separated | Keep staging telemetry separate |
| `GPU_ENTRA_GROUP_ID` | Slot-specific when access differs | Prevent staging authorization drift |

Do not mark the container image setting as slot-sticky; the release workflows intentionally update the staging image and swap it.

## Audit command

```bash
az webapp config appsettings list -g rg-cfe-apps-mj -n cloudhub-backend
az webapp config appsettings list -g rg-cfe-apps-mj -n cloudhub-backend --slot staging
az webapp config appsettings list -g rg-cfe-apps-mj -n cloudhub-frontend
az webapp config appsettings list -g rg-cfe-apps-mj -n cloudhub-frontend --slot staging
```
