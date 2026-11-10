- [Helm charts for SensaAI for Sanctions](#helm-charts-for-sensaai-for-sanctions)
  - [Requirement](#requirement)
- [Certificate lifecycle management](#certificate-lifecycle-management)
- [Installing SensaAI for Sanctions automatically](#installing-sensaai-for-sanctions-automatically)
    - [Environment](#environment)
    - [Environment variables](#environment-variables)
    - [Execution flow](#execution-flow)
    - [Example usages](#example-usages)
    - [Deploy on minikube with different namespaces and/or release name](#deploy-on-minikube-with-different-namespaces-andor-release-name)
      - [Deployment](#deployment)
- [Manual Deployment Instructions](#manual-deployment-instructions)
  - [Multi namespace deployment manually (without deploy.sh script)](#multi-namespace-deployment-manually-without-deploysh-script)
  - [Create Required Namespaces](#create-required-namespaces)
  - [Set TLS Secret for Kafka-UI](#set-tls-secret-for-kafka-ui)
    - [Create Kafka-UI Ingress Certificate](#create-kafka-ui-ingress-certificate)
  - [Set Secrets for Docker Repository](#set-secrets-for-docker-repository)
    - [Log in to the correct Docker registry](#log-in-to-the-correct-docker-registry)
      - [Amazon ECR Example](#amazon-ecr-example)
      - [DockerHub Example](#dockerhub-example)
      - [Create regcred secret](#create-regcred-secret)
  - [Set environment variables for sensitive data](#set-environment-variables-for-sensitive-data)
      - [Export the required environment variables as defined in the secret store](#export-the-required-environment-variables-as-defined-in-the-secret-store)
  - [Helm deployment of Infra Common and SensaAI for Sanctions charts](#helm-deployment-of-infra-common-and-sensaai-for-sanctions-charts)
    - [Add dependency repos](#add-dependency-repos)
    - [Commands to handle dependencies](#commands-to-handle-dependencies)
    - [Deploy nr-infra-common chart](#deploy-nr-infra-common-chart)
    - [Deploy SensaAI for Sanctions using Helm](#deploy-sensaai-for-sanctions-using-helm)
  - [Clean Up](#clean-up)
    - [Delete the deployment and associated resources](#delete-the-deployment-and-associated-resources)
    - [Full deletion, including common infra resources](#full-deletion-including-common-infra-resources)
  - [Parameters](#parameters)
    - [Global Parameters](#global-parameters)
    - [Common Parameters](#common-parameters)


# Helm charts for SensaAI for Sanctions

## Requirement

* Kubernetes 1.19+
* Helm 3.9.0+
* Kubectl
* AWS CLI

# Certificate lifecycle management

The deployment process includes the provisioning of the following operators to manage lifecycle management of the TLS certificates automatically:

- `cert-manager`: This operator simplifies certificate lifecycle management by issuing and automatically renewing TLS certificates used to protect traffic between applications deployed in the cluster.

The local private PKI will be bootstrapped under the default `sensaai` namespace with a namespace-scoped `Issuer`. The `root CA` secret will be automatically created to sign any application-generated certificate by the local `Issuer`.
This is managed as part of the `cluster-issuer` chart.

The application will have its own `Certificate` created via its own chart. Currently, the following certificates are created:


```shell
  ./sensaai-sanctions/charts/sensaai-sanctions/templates/cluster-issuer/cluster-issuer-certificate.yaml
```

The certificate will be automatically created with a corresponding secret that can be utilized by the application pods in the future.
Each certificate will have the following subject attributes:

```shell
  certificate:
    duration: "8760h"
    renewBefore: "24h"
    subject:
      organizations:
      - SensaAI
      countries:
      - IE
      organizationalUnits:
      - IT
      localities:
      - Dublin
      provinces:
      - Dublin
    privateKey:
      algorithm: ECDSA
      size: 256
    # Extra DNS(s) which needs to be added into certificate
    extraDnsList: [
      "sensaai-sanctions.local"
    ]
```

The extra DNSs entries can be added by setting up **.cetrificate.extraDnsList** parameter. It can be left as empty list to include in the certificate only default DNSs.

The certificates default expiry date is set to be 1 year, except for the Root CA, which is set to 10 years.
This ensures that a new certificate will be automatically issued when the current one expires. To configure this behavior, you can set the following parameters in the global params file:

```shell
# Section cert-manager and certificate lifecycle management
  issuer:
    selfSigned:
      certificate:
        duration: 87600h # 10 years
        renewBefore: 24h
  certificate:
    duration: 8760h # 1 year
    renewBefore: 24h
```

The certificate lifecycle management should be transparent to the end user.

# Installing SensaAI for Sanctions automatically
**./deploy.sh** script is designed to deploy "SensaAI for Sanctions" to Minikube or K8s or aks environments.

>./deploy.sh
[-h|--help]
[-e|--environment minikube or k8s or aks] // MANDATORY
[-d|--delete]
[-fd|--full-delete]
[-dr|--docker-registry DOCKER_REGISTRY]
[-drt|--docker-registry-type ECR|ACR|DH]
[-dssm| --disable-ssm]
[-f|--file-name VALUES_FILE_NAME]
[-o| --okta]
[-r|--release-name RELEASE_NAME]

### Environment
SensaAI for Sanctions can be deployed on minikube or Vanilla K8S.

**-e | --environment** is a mandatory argument for the script, based on this values and dependencies for specific environment will be applied.

-e aks - Azure Kubernetes Service
-e minikube - Minikube
-e k8s - Vanilla Kubernetes running on the EC2 instances

Values are automatically picked up by the script:

**Minikube Values:** *params-nr-minikube.yaml*
**K8S Values:** *params-nr-k8s.yaml*
**Azure AKS Values:** *params-nr-aks.yaml*

### Environment variables
The script requires certain environment variables to be set:

**ADMIN_PASSWORD:** Password for the SensaAI for Sanctions user - __admin__.
**MINIO_CLIENT_PASSWORD** Password for the MINIO client user - __customer__.
**MINIO_PASSWORD** Password for the MINIO root user - __minio__.
**SAI_ADMIN_PASSWORD:** Password for the SendaAI for Sancions user - __sai-admin__

If **-dssm|--disable-ssm** is not set, environment variables will be automatically retrieved and applied, otherwise you can apply them manually:

```bash
export ADMIN_PASSWORD="value"
export INGRESS_WILDCARD_DNS="value"
export MINIO_CLIENT_PASSWORD="value"
export MINIO_PASSWORD="value"
export SAI_ADMIN_PASSWORD="value"
```

### Execution flow
- Parses command-line arguments to configure deployment settings.
- Apply environment variables retrieved from SSM
- Checks if required environment variables are set.
- Calls the appropriate deployment function based on the specified environment.
- If the DELETE flag is set, it performs a release deletion.
- The deployment functions handle namespace creation, additional commands, and Helm chart deployment.

### Example usages

**Help**
```bash
./deploy.sh -h
```
**Deploy on AKS:**
```bash
./deploy.sh -e aks
```
**Deploy on Minikube:**
```bash
./deploy.sh -e minikube
```
**Deploy on K8s:**
```bash
./deploy.sh -e k8s
```

**Delete the deployed release:**
```bash
./deploy.sh -e minikube -d
```

**Delete the deployed release and common infra:**
Be careful if you have multiple product replicas in different namespaces, if common infra is deleted, other product replicas will also stop working.
```bash
./deploy.sh -e minikube -fd
```

**Deploy with different Docker Registry**

The script is supporting now 3 different Docker Registries:

* ECR - Elastic Container Registry
* ACR - Azure Container Registry
* DH - DockerHub

It is possible to switch to different Docker Registry (different that the one defined in the params file) by use of the _-drt|--docker-registry-type_ switch.

```bash
./deploy.sh -e minikube -drt DH
```

For each Docker registry type there is defined default value for Docker Registry:
* ECR - 519876397211.dkr.ecr.eu-west-1.amazonaws.com
* ACR - nrengdev.azurecr.io
* DH - index.docker.io/symphonysensa

In case the defined default is not proper then it can be overridden by use of _-dr|--docker-registry_ switch.

```bash
./deploy.sh -e minikube -drt DH -dr index.docker.io/symphonysensa
```

**Deploy from laptop or WSL:**
To be able to deploy from your local machine or WSL, you need to use Okta (To be able to fetch parameters from SSM):
Follow this instruction (Give this name to your profile - nrod): https://netreveal.atlassian.net/wiki/spaces/NEST/pages/27852809/Use+awscli+in+the+laptop+with+Okta+authentication

Then execute the script with proper key, example:
```bash
./deploy.sh -e aks -o
```

### Deploy on minikube with different namespaces and/or release name

#### Deployment

If you are deploying with a different namespace than the default (sensaai) or if you want to deploy a second replica of the product, you need to specify the following arguments:

- Replace `<NEW-SENSAAI-NAMESPACE>` with the desired namespace name for the SensaAI for Sanctions application.
- Replace `<NEW-SENSAAI-RELEASE-NAME>` with the desired release name for the SensaAI for Sanctions application.

Please ensure that the namespace and release name consist of lowercase alphanumeric characters and hyphens. Avoid using long names for the release name as it may cause deployment failures due to long service names.

```bash
./deploy.sh -e minikube -n <NEW-SENSAAI-NAMESPACE> -r <NEW-SENSAAI-RELEASE-NAME>
```

# Manual Deployment Instructions

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
ACR: "nrengdev.azurecr.io"
DOCKERHUB: "index.docker.io/symphonysensa"
```

Example with DockerHub
```bash
export DOCKER_REGISTRY="index.docker.io/symphonysensa"
```

Specify this variable to be able to pull the images.
If you have role for example for AKS + ACR, or K8S(EC2) + ECR this step can be skipped.

```bash
export USE_GLOBAL_PULL_SECRETS="true"
```

Add extra variables for Spark Operator:

```bash
export TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")"
export SPARK_OPERATOR_DOCKER_NAME="nri-nrod-k8s-spark-operator"
```

## Create Required Namespaces

Execute the following commands to create the required namespaces

```bash
kubectl create namespace nr-infra-common
kubectl create namespace $APP_NAMESPACE
```

## Set Secrets for Docker Repository

### Log in to the correct Docker registry

Skip this step If you have role for example for AKS + ACR, or K8S(EC2) + ECR this step can be skipped.

#### Amazon ECR Example
```bash
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin 519876397211.dkr.ecr.eu-west-1.amazonaws.com
```

#### DockerHub Example
```bash
docker login -u=<DOCKERHUB_USERNAME> -p=<DOCKERHUB_PASSWORD> index.docker.io/symphonysensa
```

#### Create regcred secret
*Application Namespace*

```bash
kubectl create secret generic regcred --from-file=.dockerconfigjson=$HOME/.docker/config.json --type=kubernetes.io/dockerconfigjson -n $APP_NAMESPACE
```

*Spark Namespace*

```bash
kubectl create secret generic regcred --from-file=.dockerconfigjson=$HOME/.docker/config.json --type=kubernetes.io/dockerconfigjson -n $SPARK_NAMESPACE
```


*In case regcred secret has to be refreshed it has to be deleted before:*

```bash
kubectl -n <PROPER-NAMESPACE> delete secret regcred
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
helm dependency build nr-infra-common
```

### Deploy nr-infra-common chart
*AKS Example.*
*For other environments use proper values file params-nr-\<ENVIRONMENT-TYPE\>.yaml*
*If you are deploying to the cluster where Ivenstigation Hub product is already deployed their infra chart, do not install this chart. [Currently, if InvestigationHub infra is deployed in the cluster, NR charts won't work because we have several operators that are not included in InvestigationHub infra charts]*

```bash
helm upgrade --install --namespace nr-infra-common nr-infra-common nr-infra-common -f params-nr-nrod.yaml
```

### Deploy SensaAI for Sanctions using Helm
*AKS Example.*
*For other environments use proper values file params-nr-\<ENVIRONMENT-TYPE\>.yaml*

```bash
helm upgrade \
    --install \
    --timeout 25m \
    --namespace $APP_NAMESPACE \
    $APP_RELEASE_NAME \
    sensaai-sanctions \
    -f params-nr-nrod.yaml \
    --set-string global.dockerRegistryName="$DOCKER_REGISTRY" \
    --set-string global.ingressWildCardDns="$INGRESS_WILDCARD_DNS" \
    --set-string global.minio.password="$MINIO_PASSWORD" \
    --set-string global.minio.clientPassword="$MINIO_CLIENT_PASSWORD" \
    --set-string global.namespace="$APP_NAMESPACE" \
    --set-string global.useImagePullSecrets="$USE_GLOBAL_PULL_SECRETS" \
    --set-string sensaai-sanctions.users.admin.pass="$ADMIN_PASSWORD" \
    --set-string sensaai-sanctions.users.sai-admin.pass="$SAI_ADMIN_PASSWORD"
```

## Clean Up

❗Be careful, these steps will also destroy the persistent volumes containing the data❗

### Delete the deployment and associated resources

```bash
helm uninstall --namespace $APP_NAMESPACE $APP_RELEASE_NAME
kubectl delete ns $APP_NAMESPACE
```

### Full deletion, including common infra resources

❗Note that if you have multiple SensaAI for Sanctions replicas in your cluster, each replica will stop working because nr-infra-common is a cluster-wide resource.❗

```bash
helm uninstall --namespace nr-infra-common nr-infra-common
kubectl delete ns nr-infra-common
kubectl delete crd $(kubectl get crds -o json | jq -r ' .items[] | .metadata.name' | grep -E 'certificaterequests.cert-manager.io|certificates.cert-manager.io|challenges.acme.cert-manager.io|clusterissuers.cert-manager.io|issuers.cert-manager.ioorders.acme.cert-manager.io')
```

## Parameters

### Global Parameters

**TODO**

### Common Parameters

**TODO**
