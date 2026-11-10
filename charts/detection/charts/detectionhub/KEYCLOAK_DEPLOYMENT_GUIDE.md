# Keycloak Deployment Guide for $NS Environment

> **HISTORICAL — does not describe the SRI platform.** This is the upstream
> DetHub guide for DetHub's OWN bundled Keycloak and its `SRIDetectionUI` realm
> import. On the SRI platform none of that applies: there is ONE shared Keycloak
> (`common.keycloak`), detectionhub's bundled keycloak/keycloak-postgres
> subcharts are disabled, realm `SRIDetectionUI` was deleted on 2026-08-13, and
> DetHub's SAML client `smui` lives in realm `SRI` where it is reasserted on
> every upgrade by `templates/keycloak-setup-job.yaml` — not by a realm import,
> which can only ever create a realm that is absent. Kept for provenance and
> because the property names below still document what core-api expects. For
> the live arrangement see `deploy/sri-dev-centraindia/README.md` and
> `docs/INVHUB-SSO.md`.

## Overview
This guide provides step-by-step instructions for deploying Keycloak in the $NS environment with proper SAML authentication integration for Core-API.

## Architecture
- **Keycloak Server**: Independent deployment at `http://dethub-internal-${NS}-keycloak.dethub.fseng.net`
- **Database**: CloudNativePG (cn-postgres) for Keycloak data
- **Authentication**: SAML 2.0 for Spring Security integration with Core-API
- **Ingress**: NGINX Ingress Controller

## Prerequisites

### 1. Deploy Keycloak PostgreSQL Database
The keycloak-postgres dependency is configured in Chart.yaml. Enable and configure it in your environment values file (for example `values-scratch.yaml`) before deploying.

**Configuration:**
- Database: `keycloak`
- Owner/User: `keycloak`
- Password Secret: `dethub-cn-postgres-app` (auto-generated)

### 2. Create Required Secrets

#### 2.1 Keycloak Admin Password Secret
```bash
kubectl create secret generic keycloak-admin-secret --from-literal=password='YOUR_SECURE_ADMIN_PASSWORD' -n $NS
```

#### 2.2 SAML Certificates Secret (The Self Signed certificate has 1 year of expiration from the generated date)
First, generate SAML certificates:
```bash
# Generate private key
openssl genrsa -out saml-signing-private.key 2048

# Generate self-signed certificate
openssl req -new -x509 -key saml-signing-private.key -out saml-signing-certificate.crt -days 365
```

Then create the secret:
```bash
kubectl create secret generic dethub-core-api-saml --from-file=saml-signing-private.key --from-file=saml-signing-certificate.crt -n $NS
```

### 3. Create Required ConfigMaps

#### 3.1 Keycloak Realm Configuration
Create a ConfigMap with realm configuration for automatic realm import:

```bash
# Create a SRIDetectionUI-realm.json file with your realm configuration (Assuming the path to the file is present where the command is running)
kubectl create configmap keycloak-realm-config --from-file=SRIDetectionUI-realm.json -n $NS
```

#### 3.2 Update keys in SRIDetectionUI-realm.json file
```
# Update line in realm json file before deployment process

Update the new keys created in step 2.2 at lines 1818 and 1821. While binding each row, make sure to include the required spacing and special characters.
For lines 862 and 876, update the certificate value, but do not include the header and footer.
Refer files attached in Jira Ticket [DETHUB-1248]
```

#### 3.3 Keycloak Providers ConfigMap (Optional - Assuming the path to the file is present where the command is running)
```bash
# If using custom providers/extensions (Assuming the path to file is present where the command is running)
kubectl create configmap keycloak-providers --from-file=keycloak-bcrypt-1.5.0.jar -n $NS
```

## Deployment Steps

### Step 1: Update Helm Dependencies (If required)
```bash
cd /path/to/charts/detectionhub
helm uninstall dethub -n $NS
```
### Step 2: Update Helm Dependencies
```bash
cd /path/to/charts/detectionhub
helm dependency update
```
### Step 3: Deploy with Helm
```bash
helm upgrade --install -n $NS dethub . -f values.yaml --rollback-on-failure --wait-for-jobs --timeout 20m --skip-crds
```

### Step 4: Verify Deployment

#### Check Keycloak Pod Status
```bash
# Check if keycloak pod is running
kubectl get pods -n $NS | grep keycloak

# Check logs
kubectl logs -n $NS -l app.kubernetes.io/name=keycloak
```

#### Check Keycloak Database
```bash
# Verify keycloak-postgres pod
kubectl get pods -n $NS | grep keycloak-postgres

# Check database connection
kubectl logs -n $NS -l app.kubernetes.io/name=keycloak -c wait-for-keycloak-db
```

#### Test Keycloak Access
```bash
# Port forward to test locally
kubectl port-forward -n $NS svc/keycloak 8080:8080

# Access at http://localhost:8080
# Login with username: admin, password: YOUR_SECURE_ADMIN_PASSWORD
```

#### Check Ingress
```bash
# Verify ingress is created
kubectl get ingress -n $NS | grep keycloak

# Check ingress details
kubectl describe ingress -n $NS keycloak
```

## SAML Configuration for Core-API Integration

### In Keycloak (Admin Console)
1. Navigate to Clients → core-api
2. Go to SAML Keys tab
3. Import the certificate from `dethub-core-api-saml` secret
4. Configure the SAML assertion consumer service URL pointing to Core-API

### In Core-API Spring Security
Configure Spring Security to use SAML:
```properties
spring.security.saml2.relyingparty.registration.keycloak.identityprovider.metadata-uri=http://dethub-keycloak:8080/realms/SRIDetectionUI/protocol/saml/descriptor
spring.security.saml2.relyingparty.registration.keycloak.identityprovider.single-sign-on-service-binding=POST
```

Use the in-cluster Keycloak service URL for server-side metadata fetches, and keep the public URL only for browser redirects.

## Deployment Order

The helm deployment now handles the correct order:
1. **keycloak-postgres** - PostgreSQL database for Keycloak
2. **cn-postgres** - PostgreSQL database for Core-API and other services
3. **keycloak** - Keycloak identity provider
4. **core-api** - Core API (depends on Keycloak being ready)
5. **core-api-ext** - Core API Extensions

## Troubleshooting

### Keycloak Pod Fails to Start
- Check if database secret exists: `kubectl get secret -n $NS | grep keycloak`
- Check admin password secret: `kubectl get secret -n $NS keycloak-admin-secret`
- Check logs: `kubectl logs -n $NS -l app.kubernetes.io/name=keycloak`

### Database Connection Issues
- Verify keycloak-postgres is running: `kubectl get pods -n $NS | grep keycloak-postgres`
- Check database logs: `kubectl logs -n $NS -l pg-cluster=keycloak-postgres-cnpg`

### Realm Configuration Not Importing
- Verify ConfigMap exists: `kubectl get configmap -n $NS keycloak-realm-config`
- Check volume mounts in deployment: `kubectl describe pod -n $NS -l app.kubernetes.io/name=keycloak`

### SAML Certificate Issues
- Verify SAML secret exists: `kubectl get secret -n $NS dethub-core-api-saml`
- Check certificate validity: `openssl x509 -in saml-cert.pem -text -noout`

## Security Considerations

1. **Strong Passwords**: Use strong passwords for admin and service accounts
2. **HTTPS in Production**: Configure TLS for Keycloak ingress in production
3. **SAML Encryption**: Enable SAML assertion encryption for production
4. **Database Backup**: Enable backup in keycloak-postgres configuration
5. **Resource Limits**: Adjust resource requests/limits based on your environment

## Rollback

If deployment fails:
```bash
helm rollback dethub -n $NS
```

## Next Steps

1. Verify Keycloak is accessible at `http://dethub-internal-${NS}-keycloak.dethub.fseng.net`
2. Login to Admin Console and configure realms/clients
3. Deploy Core-API and configure SAML integration
4. Test end-to-end SAML authentication flow
