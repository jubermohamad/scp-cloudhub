# Microsoft Entra ID Authentication Setup

## Overview

CloudHub uses Microsoft Entra ID (Azure AD) for single sign-on. This guide explains how to properly configure Entra ID to avoid `AADSTS500113` errors when rebuilding or deploying to different environments.

## Root Cause of AADSTS500113 Error

The `AADSTS500113` error occurs when the OAuth redirect URI used by the application is not registered in the Entra ID app registration. This commonly happens when:

1. **Environment-specific domains**: Deploying to different domains (dev, staging, production)
2. **Multiple app instances**: Accidentally using an Azure App Service default hostname instead of the canonical public domain
3. **Local development**: Using `localhost:3000` while Entra ID expects production URLs
4. **Rebuilds without configuration updates**: Rebuilding without ensuring all domains are registered

## Configuration

### Environment Variables

Configure these environment variables during deployment:

```bash
# Required: Entra ID credentials
AUTH_MICROSOFT_CLIENT_ID=<your-client-id>
AUTH_MICROSOFT_CLIENT_SECRET=<your-client-secret>
AUTH_MICROSOFT_TENANT_ID=<your-tenant-id>

# CRITICAL: Set this to the EXACT redirect URI for your deployment
# If not set, it defaults to: ${BACKEND_BASE_URL}/api/auth/microsoft/handler/frame
AUTH_MICROSOFT_CALLBACK_URL=https://your-domain.com/api/auth/microsoft/handler/frame

# Backend and app base URLs (used to construct callback URL if AUTH_MICROSOFT_CALLBACK_URL not set)
BACKEND_BASE_URL=https://your-domain.com
APP_BASE_URL=https://your-domain.com

# Optional: override the auth environment when you want to force a specific provider config
AUTH_ENVIRONMENT=development
```

### Entra ID App Registration Configuration

1. **Navigate to your Entra ID app registration** in Azure Portal
2. **Go to "Authentication"** blade
3. **Add ALL possible redirect URIs** that your app might use:

   ```
   https://cloudhub.symphonyai.cloud/api/auth/microsoft/handler/frame
   https://www.cloudhub.symphonyai.cloud/api/auth/microsoft/handler/frame
   https://localhost:3000/api/auth/microsoft/handler/frame
   http://localhost:3000/api/auth/microsoft/handler/frame
   ```

   Do not register or use an Azure App Service default hostname for the production CloudHub flow.

4. **Ensure these settings are enabled**:
   - ✅ Access tokens (for OAuth 2.0 auth code flow)
   - ✅ ID tokens (for OpenID Connect)
   - ✅ Allow public client flows (if using localhost for development)

## How It Works

### Backend Configuration

- App config (`app-config.yaml` / `app-config.production.yaml`) now explicitly configures `callbackUrl`
- Priority order:
  1. `AUTH_MICROSOFT_CALLBACK_URL` env var (most specific)
  2. Constructed from `BACKEND_BASE_URL` (middle ground)
  3. Constructed from `APP_BASE_URL` (fallback)
  4. Local base config defaults to `http://localhost:7007/api/auth/microsoft/handler/frame`
  5. Production overlay defaults to `https://cloudhub.symphonyai.cloud/api/auth/microsoft/handler/frame`

### Frontend Behavior

- Frontend now reads the configured callback URL from config API
- Shows the exact expected redirect URI in error messages
- Error message guides users to register this URI in Entra ID

## Deployment Checklist

Before deploying to a new environment:

- [ ] Set `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET`, `AUTH_MICROSOFT_TENANT_ID`
- [ ] Set `AUTH_MICROSOFT_CALLBACK_URL` to match your domain (or set `BACKEND_BASE_URL`)
- [ ] Register the callback URL in Entra ID app registration
- [ ] Verify app-config values are correctly inherited
- [ ] Test authentication before going live

## Troubleshooting

### "Sign-in did not complete. If Microsoft showed AADSTS500113..."

1. **Check the exact redirect URI** shown in the error message
2. **Verify it's registered** in your Entra ID app registration
3. **Clear browser cache** (Auth tokens may be cached)
4. **Check environment variables** are correctly set
5. **Verify `AUTH_MICROSOFT_CALLBACK_URL`** matches your domain

### Different URIs between dev/staging/prod

**Solution**: Set `AUTH_MICROSOFT_CALLBACK_URL` explicitly for each environment instead of relying on derived values.

### Auth works locally but fails in Azure

**Cause**: localhost redirect URI registered in Entra but used `cloudhub.symphonyai.cloud` in Azure  
**Solution**: Set `AUTH_MICROSOFT_CALLBACK_URL` to the correct domain for the deployment environment

## References

- [Backstage Microsoft Auth](https://backstage.io/docs/auth/microsoft/provider)
- [Entra ID OAuth 2.0 and OpenID Connect](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols)
- [AADSTS500113 Error](https://learn.microsoft.com/en-us/troubleshoot/azure/active-directory/error-code-AADSTS500113-invalid-redirect-uri)
