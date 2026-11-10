# CloudHub Rollback Runbook

## Immediate rollback: reverse slot swap

Use `Rollback CloudHub Production` with `mode=swap-back` when the last promotion is the known bad release and the previous release remains in the staging slots. The workflow swaps backend first and frontend second.

## Known-version rollback

Use `mode=redeploy-version`, enter a known-good tag such as `0.9.0-beta.144`, and leave `promote_after_staging=false` for a staging-only recovery. Smoke-test the staging slots, then run promotion after review.

Set `promote_after_staging=true` only when the known-good staging release has been validated and the production Environment approval is available.

## Verification

```bash
az webapp config show -g rg-cfe-apps-mj -n cloudhub-backend --query linuxFxVersion -o tsv
az webapp config show -g rg-cfe-apps-mj -n cloudhub-frontend --query linuxFxVersion -o tsv
az webapp show -g rg-cfe-apps-mj -n cloudhub-backend --slot staging --query defaultHostName -o tsv
az webapp show -g rg-cfe-apps-mj -n cloudhub-frontend --slot staging --query defaultHostName -o tsv
```

Do not rebuild images during rollback. Use only an existing immutable ACR tag or the reverse slot swap.
