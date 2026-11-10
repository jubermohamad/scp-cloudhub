# GitHub Environment Configuration

Create a GitHub Environment named `production` and configure required reviewers. The promotion and rollback workflows reference this Environment so a reviewer must approve production changes.

## OIDC secrets

Configure the canonical CloudHub platform identity as repository or environment secrets:

- `AZURE_CLIENT_ID` = `73b2043b-6230-480a-8a9a-fd37f68af1b2`
- `AZURE_TENANT_ID` = `d0fec9dd-9219-4514-a1d8-1a872244bf6e`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_CLIENT_SECRET` for workflows that use service-principal secret login

Do not configure `PLATFORM_AZURE_*` credential aliases. The service principal must have:

- Contributor access to `rg-cfe-apps-mj` and both App Services
- Permission to perform deployment slot swaps

The App Service managed identities must have `AcrPull` on `symphonyfs`.

## Federated credential

For workflows configured for OIDC, add a federated credential to the Entra app registration identified by `AZURE_CLIENT_ID`:

- Organization/repository: `jubermohamad/platform_cloudhub`
- Entity type: environment
- Environment name: `production`

Add a second credential for the repository/main branch if staging is intended to run without an environment approval.

## Slot setup

```bash
az webapp deployment slot create -g rg-cfe-apps-mj -n cloudhub-backend --slot staging
az webapp deployment slot create -g rg-cfe-apps-mj -n cloudhub-frontend --slot staging
```

See `SLOT_CONFIGURATION.md` for settings that should be marked as slot-specific.
