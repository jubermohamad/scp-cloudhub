# Access and Secrets

Start here before any deployment work.

## What you need

- Microsoft Entra sign-in to open the portal
- Repo access for the CloudHub workspace
- 1Password access for shared secrets and environment credentials
- The correct product role for the task you are doing

## How to get started

1. Open the Engineering Tools page.
2. Request 1Password access if you do not already have it.
3. Confirm you can sign in to the portal with Microsoft.
4. Confirm you have the right GitHub and Azure permissions for the task.

## How secrets are handled

- Keep shared secrets in 1Password or a synced secret source.
- Do not paste secrets into Helmfiles, PR descriptions, or config files.
- For namespace deployments, runtime secrets are supplied separately as `cloudhub-runtime-secrets`.
- If a deployment needs Microsoft or GitHub credentials, make sure those values exist before you start the wizard.

## Related UI

- Engineering Tools: `/eng-tools`
- Docs hub: `/documentation`
