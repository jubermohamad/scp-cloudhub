# Deployment Instructions for Microshift local testing

## Multi namespace deployment manually (without deploy.sh script)

Go to the location where you pulled k8's git repo.

Go to the chart folder:

Example (change the path to yours):
```bash
cd /home/ec2-user/k8s/chart
```

Specify the release name, and proper namespaces.

```bash
export APP_RELEASE_NAME="sensaai"
export APP_NAMESPACE="sensaai"
```

Specify which Docker registry you want to use.

Available options:
```yaml
ECR: "519876397211.dkr.ecr.eu-west-1.amazonaws.com"
NR ACR: "nrengdev.azurecr.io"
SCP ACR: "symphonyfs.azurecr.io/symphonysensa"
```

Example with DockerHub
```bash
export DOCKER_REGISTRY="519876397211.dkr.ecr.eu-west-1.amazonaws.com"
```

Specify this variable to be able to pull the images.
If you have role for example for AKS + ACR, or K8S(EC2) + ECR this step can be skipped.

```bash
export USE_GLOBAL_PULL_SECRETS="true"
```

## Create Required Namespaces

Execute the following commands to create the required namespaces

```bash
kubectl create namespace nr-infra-common-sensaai-sanctions
kubectl create namespace $APP_NAMESPACE
```

## Set Secrets for Docker Repository

### Log in to the correct Docker registry


#### Amazon ECR Example
```bash
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin 519876397211.dkr.ecr.eu-west-1.amazonaws.com
```

#### Create regcred secret
*Application Namespace*

```bash
kubectl create secret generic regcred --from-file=.dockerconfigjson=$HOME/.docker/config.json --type=kubernetes.io/dockerconfigjson -n $APP_NAMESPACE
```

## Set environment variables for sensitive data

#### Export the required environment variables as defined in the secret store

```bash
export ADMIN_PASSWORD="<value>"
export INGRESS_WILDCARD_DNS="<value>"
export MINIO_CLIENT_PASSWORD="<value>"
export MINIO_PASSWORD="<value>"
export SAI_ADMIN_PASSWORD="<value>"
```

Replace \<value\> with the value required for the deployment.

## Helm deployment of Infra Common and SensaAI for Sanctions charts

### Add dependency repos
```bash
helm repo add stakater https://stakater.github.io/stakater-charts
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
```

### Commands to handle dependencies
```bash
helm dependency build nr-infra-common-sensaai-sanctions
```

### Deploy nr-infra-common chart
*AKS Example.*
*For other environments use proper values file params-nr-\<ENVIRONMENT-TYPE\>.yaml*
*If you are deploying to the cluster where Ivenstigation Hub product is already deployed their infra chart, do not install this chart. [Currently, if InvestigationHub infra is deployed in the cluster, NR charts won't work because we have several operators that are not included in InvestigationHub infra charts]*

```bash
helm upgrade --install --namespace nr-infra-common-sensaai-sanctions nr-infra-common-sensaai-sanctions nr-infra-common-sensaai-sanctions -f params-s4s-aro.yaml
```


### Create service accounts, privileges and other permissions

Annotate the namespace to set UID and GID ranges
```bash
oc annotate namespace $APP_NAMESPACE \
  openshift.io/sa.scc.uid-range="100/1100000" \
  openshift.io/sa.scc.supplemental-groups="100/1100000" \
  --overwrite
```

Create Security Context Constraints (SCC) for SensaAI for Sanctions
```bash
oc create -f s4s-scc.yaml
```

Assign the created SCC to the service accounts in the application namespace
```bash
oc adm policy add-scc-to-user nr-scc -z minio-sa -n $APP_NAMESPACE
oc adm policy add-scc-to-user nr-scc -z default -n $APP_NAMESPACE
```

### Deploy SensaAI for Sanctions using Helm
```bash
helm upgrade \
    --install \
    --timeout 25m \
    --namespace $APP_NAMESPACE \
    $APP_RELEASE_NAME \
    sensaai-sanctions \
    -f params-s4s-aro.yaml \
    --set-string global.dockerRegistryName="$DOCKER_REGISTRY" \
    --set-string global.ingressWildCardDns="$INGRESS_WILDCARD_DNS" \
    --set-string global.minio.password="$MINIO_PASSWORD" \
    --set-string global.minio.clientPassword="$MINIO_CLIENT_PASSWORD" \
    --set-string global.namespace="$APP_NAMESPACE" \
    --set-string global.useImagePullSecrets="$USE_GLOBAL_PULL_SECRETS" \
    --set-string sensaai-sanctions.users.admin.pass="$ADMIN_PASSWORD" \
    --set-string sensaai-sanctions.users.sai-admin.pass="$SAI_ADMIN_PASSWORD"
```

### Delete the deployment and associated resources
```bash
helm uninstall --namespace $APP_NAMESPACE $APP_RELEASE_NAME
kubectl delete ns $APP_NAMESPACE
```