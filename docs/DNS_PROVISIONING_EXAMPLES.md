# DNS Provisioning - Historical Examples

> **Archived — do not run these commands.** The `/api/v1/dns/*` endpoints and
> hard-coded example ingress IPs below belong to a deleted implementation.
> Current DNS is provisioned automatically by the deployment portal before
> GitHub workflow dispatch. Configure the backend settings documented in
> `DNS_PROVISIONING_IMPLEMENTATION.md`; ingress IPs must come from the target
> cluster operator, not these examples.

## Quick Start

### 1. Basic DNS Provisioning

```bash
# Provision DNS for a dev environment deployment
curl -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "invhub",
    "customerCode": "sri",
    "namespace": "invhub-dt-juber-poc3"
  }'

# Response:
# {
#   "success": true,
#   "message": "DNS record created for invhub-sri-dt-juber-poc3.symphonyai.dev",
#   "dns": {
#     "fqdn": "invhub-sri-dt-juber-poc3.symphonyai.dev",
#     "ip": "4.223.72.185",
#     "action": "CREATED",
#     "isPropagated": true,
#     "appUrl": "https://invhub-sri-dt-juber-poc3.symphonyai.dev",
#     "recordId": "abc123def456"
#   }
# }
```

### 2. Prod Environment Deployment

```bash
curl -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "invhub",
    "customerCode": "sri",
    "namespace": "invhub-sri-prod-v1",
    "clusterName": "aks-scp-prod-eastus-sri",
    "environmentType": "prod"
  }'

# Response shows:
# - fqdn: "invhub-sri-prod-v1.symphonyai.cloud" (prod domain)
# - ip: "20.120.45.10" (prod ingress IP)
```

### 3. Verify Existing DNS

```bash
# Check if DNS resolves correctly without creating records
curl "http://localhost:3000/api/v1/dns/verify?fqdn=invhub-sri-dt-juber-poc3.symphonyai.dev&expectedIp=4.223.72.185"

# Response:
# {
#   "success": true,
#   "fqdn": "invhub-sri-dt-juber-poc3.symphonyai.dev",
#   "expectedIp": "4.223.72.185",
#   "isResolved": true
# }
```

### 4. Wait for DNS Propagation

```bash
# Wait for DNS to propagate with custom retry settings
curl -X POST http://localhost:3000/api/v1/dns/propagate \
  -H "Content-Type: application/json" \
  -d '{
    "fqdn": "invhub-sri-dt-juber-poc3.symphonyai.dev",
    "expectedIp": "4.223.72.185",
    "maxRetries": 10,
    "retryDelayMs": 1000
  }'

# Response:
# {
#   "success": true,
#   "fqdn": "invhub-sri-dt-juber-poc3.symphonyai.dev",
#   "expectedIp": "4.223.72.185",
#   "isPropagated": true
# }
```

## Advanced Usage

### Multiple Customers

```bash
# Abanca customer
curl -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "invhub",
    "customerCode": "abanca",
    "namespace": "invhub-abanca-staging",
    "clusterName": "aks-scp-dev-westeurope",
    "environmentType": "dev"
  }'
# Result: invhub-abanca-staging.symphonyai.dev → 51.144.120.80

# Corporate client
curl -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "invhub",
    "customerCode": "corporate-bank",
    "namespace": "invhub-corporate-bank-prod",
    "clusterName": "aks-scp-prod-westeurope",
    "environmentType": "prod"
  }'
# Result: invhub-corporate-bank-prod.symphonyai.cloud → 51.144.136.40
```

### Batch Processing (Script)

```bash
#!/bin/bash
# Deploy multiple customer instances

DEPLOYMENTS=(
  "invhub:sri:invhub-dt-juber-poc3:aks-scp-dev-eastus-sri:dev"
  "invhub:abanca:invhub-staging:aks-scp-dev-westeurope:dev"
  "invhub:corporate:invhub-prod-v2:aks-scp-prod-eastus-sri:prod"
)

for deployment in "${DEPLOYMENTS[@]}"; do
  IFS=':' read -r app customer namespace cluster env <<< "$deployment"
  
  echo "Provisioning DNS for $namespace..."
  
  response=$(curl -s -X POST http://localhost:3000/api/v1/dns/provision \
    -H "Content-Type: application/json" \
    -d "{
      \"appName\": \"$app\",
      \"customerCode\": \"$customer\",
      \"namespace\": \"$namespace\",
      \"clusterName\": \"$cluster\",
      \"environmentType\": \"$env\"
    }")
  
  if echo "$response" | jq -e '.success' > /dev/null; then
    appUrl=$(echo "$response" | jq -r '.dns.appUrl')
    echo "✓ DNS ready: $appUrl"
  else
    error=$(echo "$response" | jq -r '.error')
    echo "✗ DNS provisioning failed: $error"
    exit 1
  fi
done

echo "All DNS records provisioned successfully"
```

### Integration with Deployment Orchestrator

```typescript
// In your deployment workflow (e.g., createProvisioningRouter.ts)

async function deployApplication(job: DeploymentJob) {
  const { appName, customerCode, namespace, cluster, environment } = job;

  // Step 1: Provision DNS
  try {
    logger.info('Provisioning DNS...');
    const dnsResponse = await fetch(
      `${process.env.APP_URL}/api/v1/dns/provision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName,
          customerCode,
          namespace,
          clusterName: cluster,
          environmentType: environment,
        }),
      }
    );

    if (!dnsResponse.ok) {
      throw new Error('DNS provisioning failed');
    }

    const dnsData = await dnsResponse.json();
    const appUrl = dnsData.dns.appUrl;

    logger.info(`DNS ready: ${appUrl}`);

    // Step 2: Deploy application
    logger.info('Deploying application...');
    await deployHelmChart({
      appName,
      namespace,
      cluster,
    });

    // Step 3: Health check
    logger.info('Waiting for application to be ready...');
    await waitForAppReady(appUrl, 300_000); // 5 minute timeout

    return {
      status: 'SUCCESS',
      appUrl,
      deployedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Deployment failed', { error: error.message });
    throw error;
  }
}
```

### Using with Terraform/IaC

```hcl
# terraform/main.tf

variable "cloudflare_api_token" {
  sensitive = true
}

variable "cloudflare_zone_id" {
  sensitive = true
}

resource "null_resource" "dns_provisioning" {
  provisioners = {
    local_exec {
      command = <<-EOT
        curl -X POST http://localhost:3000/api/v1/dns/provision \
          -H "Content-Type: application/json" \
          -d '{
            "appName": "${var.app_name}",
            "customerCode": "${var.customer_code}",
            "namespace": "${var.namespace}",
            "clusterName": "${var.cluster_name}",
            "environmentType": "${var.environment}"
          }'
      EOT
    }
  }

  depends_on = [azurerm_kubernetes_cluster.main]
}
```

## Command-Line Usage

### Using curl

```bash
# Simple provision
curl -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "invhub",
    "customerCode": "sri",
    "namespace": "invhub-test"
  }'

# Pretty print response
curl -s -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{"appName":"invhub","customerCode":"sri","namespace":"invhub-test"}' \
  | jq .

# Extract just the app URL
curl -s -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{"appName":"invhub","customerCode":"sri","namespace":"invhub-test"}' \
  | jq -r '.dns.appUrl'
```

### Using HTTP Client (VS Code REST Client)

```rest
### Provision DNS for dev
POST http://localhost:3000/api/v1/dns/provision
Content-Type: application/json

{
  "appName": "invhub",
  "customerCode": "sri",
  "namespace": "invhub-dt-juber-poc3",
  "clusterName": "aks-scp-dev-eastus-sri",
  "environmentType": "dev"
}

### Verify DNS Resolution
GET http://localhost:3000/api/v1/dns/verify?fqdn=invhub-sri-dt-juber-poc3.symphonyai.dev&expectedIp=4.223.72.185

### Wait for Propagation
POST http://localhost:3000/api/v1/dns/propagate
Content-Type: application/json

{
  "fqdn": "invhub-sri-dt-juber-poc3.symphonyai.dev",
  "expectedIp": "4.223.72.185",
  "maxRetries": 6,
  "retryDelayMs": 2000
}
```

### Using Python

```python
import requests
import json

class DNSProvisioner:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url

    def provision(self, app_name, customer_code, namespace, 
                  cluster_name="aks-scp-dev-eastus-sri", 
                  environment="dev"):
        """Provision DNS for an application"""
        response = requests.post(
            f"{self.base_url}/api/v1/dns/provision",
            json={
                "appName": app_name,
                "customerCode": customer_code,
                "namespace": namespace,
                "clusterName": cluster_name,
                "environmentType": environment,
            }
        )
        response.raise_for_status()
        return response.json()

    def verify(self, fqdn, expected_ip):
        """Verify DNS resolution"""
        response = requests.get(
            f"{self.base_url}/api/v1/dns/verify",
            params={"fqdn": fqdn, "expectedIp": expected_ip}
        )
        response.raise_for_status()
        return response.json()

    def wait_for_propagation(self, fqdn, expected_ip, 
                           max_retries=6, retry_delay_ms=2000):
        """Wait for DNS to propagate"""
        response = requests.post(
            f"{self.base_url}/api/v1/dns/propagate",
            json={
                "fqdn": fqdn,
                "expectedIp": expected_ip,
                "maxRetries": max_retries,
                "retryDelayMs": retry_delay_ms,
            }
        )
        response.raise_for_status()
        return response.json()

# Usage
provisioner = DNSProvisioner()

# Provision DNS
result = provisioner.provision(
    app_name="invhub",
    customer_code="sri",
    namespace="invhub-dt-juber-poc3"
)

print(f"App URL: {result['dns']['appUrl']}")
print(f"DNS Status: {'Propagated' if result['dns']['isPropagated'] else 'Pending'}")

# Verify
verification = provisioner.verify(
    result['dns']['fqdn'],
    result['dns']['ip']
)
print(f"DNS Verified: {verification['isResolved']}")
```

### Using Node.js

```typescript
interface DnsProvisionRequest {
  appName: string;
  customerCode: string;
  namespace: string;
  clusterName?: string;
  environmentType?: 'dev' | 'prod';
}

async function provisionDns(req: DnsProvisionRequest): Promise<string> {
  const response = await fetch('http://localhost:3000/api/v1/dns/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    throw new Error(`DNS provisioning failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.dns.appUrl;
}

// Usage
const appUrl = await provisionDns({
  appName: 'invhub',
  customerCode: 'sri',
  namespace: 'invhub-dt-juber-poc3',
});

console.log(`Application available at: ${appUrl}`);
```

## Environment Configuration

### Azure App Service

1. Navigate to Configuration → Application settings
2. Add new application settings:
   - `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token
   - `CLOUDFLARE_ZONE_ID`: Your Cloudflare zone ID

### Local Development

```bash
# .env file
CLOUDFLARE_API_TOKEN=your_token_here
CLOUDFLARE_ZONE_ID=your_zone_id_here
```

## Monitoring & Debugging

### Check DNS Provisioning Status

```bash
# Verify a specific DNS record
dig invhub-sri-dt-juber-poc3.symphonyai.dev A

# Short format
dig +short invhub-sri-dt-juber-poc3.symphonyai.dev

# Query specific nameserver
dig @8.8.8.8 invhub-sri-dt-juber-poc3.symphonyai.dev

# Check with nslookup
nslookup invhub-sri-dt-juber-poc3.symphonyai.dev

# DNS trace (dig +trace)
dig +trace invhub-sri-dt-juber-poc3.symphonyai.dev
```

### Check Application Logs

```bash
# View recent DNS provisioning logs
kubectl logs -n default deployment/cloudhub-backend --tail=100 | grep DNS

# Stream real-time logs
kubectl logs -f -n default deployment/cloudhub-backend | grep DNS

# Filter by customer
kubectl logs -n default deployment/cloudhub-backend | grep "sri"
```

### Cloudflare API Debugging

```bash
# List all DNS records in zone
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records" \
  -H "Authorization: Bearer {API_TOKEN}" \
  -H "Content-Type: application/json" | jq .

# Get specific DNS record
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records?name=invhub-sri-poc3.symphonyai.dev" \
  -H "Authorization: Bearer {API_TOKEN}" | jq .

# Test API token
curl -s -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer {API_TOKEN}" | jq .
```

## Performance Testing

### Load Testing

```bash
#!/bin/bash
# Test DNS provisioning under load

num_requests=10
for i in $(seq 1 $num_requests); do
  customer="customer$i"
  namespace="invhub-$customer-test"
  
  echo "Request $i: $namespace"
  
  curl -s -X POST http://localhost:3000/api/v1/dns/provision \
    -H "Content-Type: application/json" \
    -d "{
      \"appName\": \"invhub\",
      \"customerCode\": \"$customer\",
      \"namespace\": \"$namespace\"
    }" &
done

wait
echo "All requests completed"
```

### Benchmark

```bash
# Using Apache Bench
ab -n 100 -c 10 -p request.json -T application/json http://localhost:3000/api/v1/dns/provision

# Using hey (modern HTTP benchmarking)
hey -n 100 -c 10 -m POST -H "Content-Type: application/json" \
  -d '{"appName":"invhub","customerCode":"sri","namespace":"invhub-test"}' \
  http://localhost:3000/api/v1/dns/provision
```

## Error Handling Examples

### Missing Parameters

```bash
curl -X POST http://localhost:3000/api/v1/dns/provision \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "invhub"
    # Missing customerCode and namespace
  }'

# Response:
# {
#   "success": false,
#   "error": "Missing required fields: appName, customerCode, namespace"
# }
```

### Invalid Cloudflare Credentials

```bash
# If CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not set

# Response:
# {
#   "success": false,
#   "error": "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID in environment."
# }
```

### API Rate Limiting

```bash
# If Cloudflare rate limit is hit

# Response:
# {
#   "success": false,
#   "error": "Cloudflare DNS creation failed: You have exceeded the rate limit for this operation."
# }
```
