# CloudHub Azure Resource Inventory

This document captures the current Azure resource and Microsoft Entra configuration for CloudHub as of 2026-09-06.

## 1) Azure subscription and tenant

- Subscription name: Azure Sensa Engineering
- Subscription ID: b0799078-b42a-4b59-9e70-22cd09a20ee2
- Tenant ID: d0fec9dd-9219-4514-a1d8-1a872244bf6e
- Home tenant ID: d0fec9dd-9219-4514-a1d8-1a872244bf6e
- Default Azure account: AzureCloud
- Azure tenant domain: symphonysensa.com

## 2) Resource group inventory

The following resource group is directly relevant to CloudHub:

- Resource group: rg-cfe-apps-mj
- Location: swedencentral

Additional important Azure resource groups in the same tenant include:

- rg-scp-dev-sdc-st-cms
- fr-napoleon-rg
- rg-scp-dev-frc-st-scp
- rg-scp-subscriptions or other platform groups as applicable to deployment and networking

## 3) App Service / Azure Web App resources

### Frontend app

- App name: cloudhub-frontend
- Resource group: rg-cfe-apps-mj
- Azure platform default hostname (infrastructure only): cloudhub-frontend.azurewebsites.net
- Runtime kind: app,linux,container
- State: Running

### Backend app

- App name: cloudhub-backend
- Resource group: rg-cfe-apps-mj
- Azure platform default hostname (infrastructure only): cloudhub-backend-fycud6akgdcvbyhd.swedencentral-01.azurewebsites.net
- Runtime kind: app,linux,container
- State: Running

### Public CloudHub URLs

- Frontend public URL: https://cloudhub.symphonyai.cloud
- Backend public URL: https://cloudhub.symphonyai.cloud
- Microsoft callback route: https://cloudhub.symphonyai.cloud/api/auth/microsoft/handler/frame

## 4) App Service app settings relevant to login

The following app settings are configured on the backend App Service and are used for Microsoft authentication and runtime URL configuration:

- APP_BASE_URL = https://cloudhub.symphonyai.cloud
- BACKEND_BASE_URL = https://cloudhub.symphonyai.cloud
- APP_CONFIG_backend_baseUrl = https://cloudhub.symphonyai.cloud
- APP_CONFIG_auth_providers_microsoft_production_callbackUrl = https://cloudhub.symphonyai.cloud/api/auth/microsoft/handler/frame
- AUTH_MICROSOFT_CLIENT_ID = 73b2043b-6230-480a-8a9a-fd37f68af1b2
- AUTH_MICROSOFT_TENANT_ID = d0fec9dd-9219-4514-a1d8-1a872244bf6e
- AUTH_MICROSOFT_CLIENT_SECRET = configured in Azure App Service configuration and must match the app registration secret

Notes:

- The CloudHub frontend and backend app services are intentionally aligned to the public production domain rather than the default Azure App Service hostnames to avoid redirect drift.
- The Microsoft login callback must exactly match the app registration redirect URIs for the flow to succeed.

## 5) Azure network topology: VNet, subnets, private endpoints, and Application Gateway

### VNet

- VNet name: vnet-scp-dev-sdc-st-qa
- Resource group: rg-cfe-apps-mj
- Location: swedencentral
- Address space: 10.0.0.0/16

### Subnets

- subnet name: snet-appgw
  - address prefix: 10.0.0.0/24
- subnet name: snet-private-endpoints
  - address prefix: 10.0.1.0/24

### Private endpoints

- cloudhub-pg-pe
  - resource group: rg-cfe-apps-mj
  - location: swedencentral
- pe-cloudhub-backend
  - resource group: rg-cfe-apps-mj
  - location: swedencentral
- pe-cloudhub-frontend
  - resource group: rg-cfe-apps-mj
  - location: swedencentral

These private endpoints indicate the platform is set up to support private connectivity for data and App Service access patterns in the CloudHub environment.

### Application Gateway

- Application gateway name: agw-cloudhub
- Resource group: rg-cfe-apps-mj
- Location: swedencentral
- SKU: WAF_v2
- Backend pool: cloudhub-frontend-pool
- Backend target: cloudhub-frontend.azurewebsites.net (Azure infrastructure target; not a public auth URL)

This shows the App Gateway is fronting the CloudHub frontend through a WAF v2 tier setup in the same resource group.

## 6) Microsoft Entra app registration

### App registration identity

- Display name: scp-platform-svc-root
- Application (client) ID: 73b2043b-6230-480a-8a9a-fd37f68af1b2
- Object ID: e890021d-716e-42bc-ab4a-7db2109a8613
- Tenant domain: symphonysensa.com

### Current app registration purpose

This app registration is being used for:

- Microsoft login for CloudHub Backstage / auth provider
- Azure automation / platform operations
- Shared platform service identity for CloudHub and Azure automation flows

### Required redirect URIs for sign-in

The app registration includes browser redirect URIs that correspond to the CloudHub login flow, including:

- https://cloudhub.symphonyai.cloud
- https://cloudhub.symphonyai.cloud/api/auth/microsoft/handler/frame
- https://cloudhub.symphonyai.cloud/.auth/login/aad/callback
- http://localhost:3000/api/auth/microsoft/handler/frame
- http://localhost:7007/api/auth/microsoft/handler/frame
- http://127.0.0.1:3000/api/auth/microsoft/handler/frame

Important note:

- The production callback must remain aligned with the live CloudHub origin.
- Azure App Service default hostnames are infrastructure endpoints only and
  must not be used for production `APP_BASE_URL`, `BACKEND_BASE_URL`, or OAuth
  callback URLs.
- If the app is used against a different domain or a stale App Service hostname, Microsoft rejects the flow with AADSTS500113 or origin mismatch errors.

## 7) Backstage auth configuration

Backstage is configured to use the Microsoft provider with the following values:

- AUTH_MICROSOFT_CLIENT_ID = 73b2043b-6230-480a-8a9a-fd37f68af1b2
- AUTH_MICROSOFT_TENANT_ID = d0fec9dd-9219-4514-a1d8-1a872244bf6e
- Authentication callback provider: Microsoft production provider in app-config.yaml and app-config.production.yaml

Relevant config files in the repo:

- app-config.yaml
- app-config.production.yaml
- .env

The important behavior is that the Microsoft provider callback URL must match the actual deployed public origin, and the backend CORS allowlist must accept that origin.

## 8) Root cause pattern observed

The main recurring login issue is not necessarily the client ID itself, but configuration drift between:

- the Azure app registration redirect URIs
- the App Service app settings
- the public CloudHub origin
- the backend CORS allowlist

The common failure modes are:

- redirect URI mismatch between Entra and the live origin
- stale Azure App Service hostnames still configured after a public domain migration
- origin blocked by CORS before auth completes
- expired or mismatched client secret in the app registration

## 9) Recommended operational checklist

1. Keep one canonical public origin for CloudHub.
2. Verify every Microsoft redirect URI matches the canonical public URL.
3. Ensure App Service app settings use the same public origin.
4. Keep app registration secrets synchronized with the live environment.
5. Re-test sign-in after any URL, hostname, or certificate change.
6. Keep this document in sync whenever Azure resources change.

## 10) Summary

CloudHub is currently operating in the Azure subscription b0799078-b42a-4b59-9e70-22cd09a20ee2 under tenant d0fec9dd-9219-4514-a1d8-1a872244bf6e. The Microsoft Entra application used for the platform and login is scp-platform-svc-root with client ID 73b2043b-6230-480a-8a9a-fd37f68af1b2. The CloudHub app services live in resource group rg-cfe-apps-mj and are currently aligned around the production hostname https://cloudhub.symphonyai.cloud.
