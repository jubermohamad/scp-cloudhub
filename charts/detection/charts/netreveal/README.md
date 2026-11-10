- [Helm charts guide for netreveal](#helm-charts-guide-for-netreveal)
  - [Requirements](#requirements)
  - [Minikube environment](#minikube-environment)
    - [Container runtime](#container-runtime)
    - [Network CNI plugin support for network policies](#network-cni-plugin-support-for-network-policies)
  - [Certificate lifecycle management](#certificate-lifecycle-management)
  - [Configuring IP Whitelist for Ingress Controllers](#configuring-ip-whitelist-for-ingress-controllers)
    - [General Configuration](#general-configuration)
    - [Configuration in Netreveal Chart](#configuration-in-netreveal-chart)
    - [Overriding Default Settings](#overriding-default-settings)
    - [Exceptions: Kafka-UI and Keycloak](#exceptions-kafka-ui-and-keycloak)
- [Installing NetReveal automatically](#installing-netreveal-automatically)
    - [Environment](#environment)
    - [Environment variables](#environment-variables)
    - [Execution flow](#execution-flow)
    - [Example usages](#example-usages)
    - [Deploy on minikube with different namespaces and/or release name](#deploy-on-minikube-with-different-namespaces-andor-release-name)
      - [Deployment](#deployment)
- [Manual Deployment Instructions](#manual-deployment-instructions)
  - [Multi namespace deployment manually (without deploy.sh script)](#multi-namespace-deployment-manually-without-deploysh-script)
  - [Create Required Namespaces](#create-required-namespaces)
  - [Nginx Configuration](#nginx-configuration)
    - [TCP ports configuration](#tcp-ports-configuration)
    - [Additional ingress settings](#additional-ingress-settings)
  - [Set Secrets for Nrodsftp and Minio](#set-secrets-for-nrodsftp-and-minio)
    - [Create secret from SSH key](#create-secret-from-ssh-key)
    - [Create secret from PGP key](#create-secret-from-pgp-key)
    - [Create Minio Ingress Certificate](#create-minio-ingress-certificate)
  - [Set TLS Secret for external Kafka instances](#set-tls-secret-for-external-kafka-instances)
  - [Set TLS Secret for external certificates](#set-tls-secret-for-external-certificates)
  - [Set TLS Secret for Kafka-UI](#set-tls-secret-for-kafka-ui)
    - [Create Kafka-UI Ingress Certificate](#create-kafka-ui-ingress-certificate)
  - [Set TLS Secrets for Keycloak](#set-tls-secrets-for-keycloak)
    - [Create Keycloak Ingress Certificate](#create-keycloak-ingress-certificate)
  - [Set Secrets for Docker Repository](#set-secrets-for-docker-repository)
    - [Log in to the correct Docker registry](#log-in-to-the-correct-docker-registry)
      - [Amazon ECR Example](#amazon-ecr-example)
      - [DockerHub Example](#dockerhub-example)
      - [Create regcred secret](#create-regcred-secret)
  - [Set environment variables for sensitive data](#set-environment-variables-for-sensitive-data)
      - [Export the required environment variables as defined in the secret store](#export-the-required-environment-variables-as-defined-in-the-secret-store)
  - [Helm deployment of Infra Common and Netreveal charts](#helm-deployment-of-infra-common-and-netreveal-charts)
    - [Add dependency repos](#add-dependency-repos)
    - [Commands to handle dependencies](#commands-to-handle-dependencies)
    - [Deploy nr-infra-common chart](#deploy-nr-infra-common-chart)
    - [Deploy Netreveal using Helm](#deploy-netreveal-using-helm)
  - [Clean Up](#clean-up)
    - [Delete the deployment and associated resources](#delete-the-deployment-and-associated-resources)
    - [Full deletion, including common infra resources](#full-deletion-including-common-infra-resources)
  - [Parameters](#parameters)
    - [Global Parameters](#global-parameters)
    - [Common Parameters](#common-parameters)


# Helm charts guide for netreveal

## Requirements

* Kubernetes 1.19+
* Helm 3.9.0+
* Kubectl
* AWS CLI
* CNI plugin (Calico, Weave, etc.) is enabled in the cluster to support network policies.

## Minikube environment

The following considerations should be taken into account when deploying NetReveal on Minikube.

### Container runtime

Docker runtime has been deprecated in Azure AKS and other cloud providers as a default container runtime, in favor of `containerd`. However, Minikube still uses Docker as the default container runtime. To use `containerd` as the container runtime in Minikube, you can use the following command:

```shell
minikube config set container-runtime containerd
```

The next time you start Minikube, it will use `containerd` as the container runtime.

> **Note:** There is a check added in the `deploy.sh` script to ensure that the container runtime is set to `containerd` before deploying the NetReveal application.

### Network CNI plugin support for network policies

In order to enable the network policies in Minikube, you need to install the Calico CNI plugin. To install the Calico CNI plugin, you can use the following command:

```shell
minikube start --network-plugin=cni --cni=calico
```

## Certificate lifecycle management

The deployment process includes the provisioning of the following operators to manage lifecycle management of the TLS certificates automatically:

- `cert-manager`: This operator simplifies certificate lifecycle management by issuing and automatically renewing TLS certificates used to protect traffic between applications deployed in the cluster.

The local private PKI will be bootstrapped under the default `netreveal` namespace with a namespace-scoped `Issuer`. The `root CA` secret will be automatically created to sign any application-generated certificate by the local `Issuer`.
This is managed as part of the `cluster-issuer` chart.

Each application will have its own `Certificate` created via its own chart. Currently, the following certificates are created:


```shell
  ./netreveal/charts/aap/templates/certificate-aap.yaml
  ./netreveal/charts/nr-ui/templates/certifcate-ui.yaml
  ./netreveal/charts/opensearch/templates/certificate-opensearch.yaml
  ./netreveal/charts/wlm-pn-rt/templates/certificate-wlm.yaml
```

Each certificate will be automatically created with a corresponding secret that can be utilized by the application pods in the future.
Additionally, the certificates will be issued in the JKS keystore format (`PKCS12`), which will include two extra keys: `keystore.p12` and `truststore.p12`, along with the TLS certificate, key, and `Root CA`.
Each certificate will have the following subject attributes:

```shell
  Subject:
    Countries:
      IE
    Localities:
      Dublin
    Organizational Units:
      IT
    Organizations:
      Netreveal
    Provinces:
      Dublin
```

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

## Configuring IP Whitelist for Ingress Controllers

This section outlines the process for configuring IP whitelisting on Nginx ingress controllers for various components in our Kubernetes deployment.

### General Configuration

The following annotation can be used to allow a custom list of IP ranges for the Nginx ingress controller:

```yaml
nginx.ingress.kubernetes.io/whitelist-source-range: "range1,range2,..."
```

Each range corresponds to an IP network range (mask can be provided in x/y notation). For example:

```yaml
nginx.ingress.kubernetes.io/whitelist-source-range: "192.168.1.0/24,10.0.0.0/16"
```

This configuration will allow access only from the specified IP ranges.

### Configuration in Netreveal Chart

The following is configured in the Netreveal main chart (`values.yaml`) under each sub-chart specific configuration. Look up the following lines in the respective sub-charts:

```yaml
ingress:
  ingressAllowList:
    customerIPs: []
    platformIPs: []
```

By default, these values are not set, so the annotation won't be added unless at least one IP range is defined.

### Overriding Default Settings

You can override these settings either in the `values.yaml` of Netreveal or in the corresponding `params` file.

This override feature is available for the following components:
- nr-ui
- wlm-pn-rt
- minio
- minio-console
- sensaai-sanctions
- nrodsftp

### Exceptions: Kafka-UI and Keycloak

For Kafka-UI and Keycloak, the process is slightly different. You need to adjust the `annotations` key directly.

For example, in Kafka-UI's `values.yaml`:

Instead of:
```yaml
ingress:
  annotations: {}
```

Use:
```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/whitelist-source-range: "range1,range2,..."
```

Apply the same approach for Keycloak.


# Installing NetReveal automatically
**./deploy.sh** script is designed to deploy "netreveal" to Minikube or K8s environments.

>./deploy.sh
[-h|--help]
[-e|--environment minikube or k8s or aks] // MANDATORY
[-d|--delete]
[-fd|--full-delete]
[-dr|--docker-registry DOCKER_REGISTRY]
[-drt|--docker-registry-type ECR|ACR|SCP|DH]
[-dssm| --disable-ssm]
[-f|--file-name VALUES_FILE_NAME]
[-o| --okta]
[-r|--release-name RELEASE_NAME]
[-mn |--monitoring-namespace NAMESPACE]

### Environment
NetReveal can be deployed on minikube or Vanilla K8S.

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

**NR_KEYSTORE_PASSWORD:** Password for the netreveal keystore.
**NR_KEYSTORE_KEY_PASSWORD:** Password for the netreveal keystore key.
**AAP_JDBC_PASSWORD:** Password for AAP database.
**AAP_ADMIN_PASSWORD:** Password for the AAP Admin page.
**TRUST_STORE_PASSWORD** Password for the Standalone trust store
**OPENSEARCH_INTERNAL_USER** Password for the opensearch admin

If **-dssm|--disable-ssm** is not set, environment variables will be automatically retrieved and applied, otherwise you can apply them manually:

```bash
export AAP_ADMIN_PASSWORD="value"
export AAP_JDBC_PASSWORD="value"
export CLIENT_SUBDOMAIN="value"
export DB_LICENCE_KEY="value"
export ENV_TYPE="value"
export FACTIVA_USER_PASSWORD="value"
export INGRESS_WILDCARD_DNS="value"
export KAFKA_UI_PASSWORD="value"
export KAFKA_UI_TLS_PRIVATE_KEY="value"
export KAFKA_UI_TLS_PUBLIC_KEY="value"
export KEYCLOAK_ADMIN_PASSWORD="value"
export KEYCLOAK_DB_USER_PASSWORD="value"
export KEYCLOAK_ENABLE="value"
export MINIO_CLIENT_PASSWORD="value"
export MINIO_PASSWORD="value"
export MINIO_PSQL_PASSWORD="value"
export MINIO_TLS_PRIVATE_KEY="value"
export MINIO_TLS_PUBLIC_KEY="value"
export ORGUNIT_1_PASSWORD="value"
export ORGUNIT_2_PASSWORD="value"
export NR_KEYSTORE_KEY_PASSWORD="value"
export NR_KEYSTORE_PASSWORD="value"
export NRODSFTP_PRIVATE_KEY="value"
export NRODSFTP_PUBLIC_KEY="value"
export NRODSFTP_PGP_PRIVATE_KEY="value"
export NRODSFTP_PGP_PUBLIC_KEY="value"
export NRODSFTP_PGP_PASSPHRASE="value"
export OPENSEARCH_INTERNAL_USER="value"
export POSTGRES_AAP_USER_PASSWORD="value"
export POSTGRES_ENTRES_PASSWORD="value"
export POSTGRES_SUPERUSER_PASSWORD="value"
export POSTGRES_USER_PASSWORD="value"
export POSTGRES_IMPORT_USER_PASSWORD="value"
export SAML_ENABLE="value"
export SENSAAI_ADMIN_PASSWORD="value"
export TRUST_STORE_PASSWORD="value"
export WORLDCHECK_USER_PASSWORD="value"
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

The script is supporting now 4 different Docker Registries:

* ECR - Elastic Container Registry
* ACR - Azure Container Registry
* SCP - SCP Azure Container Registry
* DH - DockerHub

It is possible to switch to different Docker Registry (different that the one defined in the params file) by use of the _-drt|--docker-registry-type_ switch.

```bash
./deploy.sh -e minikube -drt DH
```

For each Docker registry type there is defined default value for Docker Registry:
* ECR - 519876397211.dkr.ecr.eu-west-1.amazonaws.com
* ACR - nrengdev.azurecr.io
* SCP - symphonysensa.azurecr.io
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

If you are deploying with a different namespace than the default (netreveal) or if you want to deploy a second replica of the product, you need to specify the following arguments:

- Replace `<NEW-NETREVEAL-NAMESPACE>` with the desired namespace name for the Netreveal application and Spark apps.
- Replace `<NEW-MONITORING-NAMESPACE>` with the desired namespace name for the monitoring.
- Replace `<NEW-NETREVEAL-RELEASE-NAME>` with the desired release name for the Netreveal application.

Please ensure that the namespace and release name consist of lowercase alphanumeric characters and hyphens. Avoid using long names for the release name as it may cause deployment failures due to long service names.

```bash
./deploy.sh -e minikube -n <NEW-NETREVEAL-NAMESPACE> -mn <NEW-MONITORING-NAMESPACE> -r <NEW-NETREVEAL-RELEASE-NAME>
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
export APP_RELEASE_NAME="netreveal"
export APP_NAMESPACE="netreveal"
export MONITORING_NAMESPACE="nr-monitoring"
```

Specify which Docker registry you want to use.

Available options:
```yaml
ECR: "519876397211.dkr.ecr.eu-west-1.amazonaws.com"
ACR: "nrengdev.azurecr.io"
SCP: "symphonysensa.azurecr.io"
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
export SPARK_OPERATOR_DOCKER_NAME="nri-nrod-k8s-spark-operator"
```

## Create Required Namespaces

Execute the following commands to create the required namespaces

```bash
kubectl create namespace nr-infra-common
kubectl create namespace $APP_NAMESPACE
kubectl create namespace $MONITORING_NAMESPACE
```

## Nginx Configuration
### TCP ports configuration
*If you are deploying the product to a namespace other than netreveal, or if you are deploying an additional replica of the product in the same cluster, you should change the ingress settings for Nrodsftp.
Use  params-nr-\<ENVIRONMENT-TYPE\>-v93.yaml specifically for your environment.
For example, if you are deploying another replica of the product and your namespace is netreveal2, you can use the following pattern*:
```bash
ingress-nginx:
  tcp:
    8022: netreveal/minio:8022
    8023: netreveal2/minio:8022
  controller:
    service:
      nodePorts:
        tcp:
          8022: 30822
          8023: 30823
```
*Also add the appropriate nodePort to the appropriate section.
If you just want to change the current namespace, simply change netreveal netreveal/minio:8022 to a different namespace name.
If you are not using nr ingress nginx, you can specify these values in your ingress nginx values file.*

### Additional ingress settings
*To prevent 413 Request Entity Too Large error, nginx should be deployed with proxy-body-size parameter.
If nginx from nr-infra-common was deployed this setting is on place by default in params-nr-\<ENVIRONMENT-TYPE\>-v93.yaml.
If not please specify this setting in your nginx values file and upgrade nginx release.*
```bash
ingress-nginx:
  controller:
    config:
      proxy-body-size: "10m"
```



## Set Secrets for Nrodsftp and Minio

### Create secret from SSH key
*Change the path to the private and public keys to the location where your keys are, and change the key names to appropriate values*

```bash
kubectl -n $APP_NAMESPACE create secret generic nrodsftp-ssh-key --from-file=id_rsa=/home/klu4ic/sftp/keys/NRApplicationEngineering.pem --from-file=id_rsa.pub=/home/klu4ic/sftp/keys/NRApplicationEngineering.pub
```
### Create secret from PGP key
*If PGP encryption/decription is required, you need to set enablePgp: true variable in the nrodsftp section of relevant params file*

*Change the path to the private and public keys to the location where your keys are, and change the key names to appropriate values*

```bash
kubectl -n $APP_NAMESPACE create secret generic nrodsftp-pgp-key --from-file=private-key=/home/klu4ic/sftp/keys/pgp-key --from-file=public-key=/home/klu4ic/sftp/keys/pgp-key.pub --from-literal=passphrase="put_passphrase_here"
kubectl -n $APP_NAMESPACE create secret generic nrodsftp-archiving-pgp-key --from-file=public-key=/home/klu4ic/sftp/keys/public-pgp-key.pub
```
### Create Minio Ingress Certificate
*Change the path to the private and public keys to the location where your keys are, and change the key names to appropriate values*
```bash
kubectl -n  $APP_NAMESPACE create secret tls https-certs --key=/home/klu4ic/sftp/certgen/private.key --cert=/home/klu4ic/sftp/certgen/public.crt
```
## Set TLS Secret for external Kafka instances

The set up is described on [Secure Connection to External Kafka Brokers via SSL](https://netreveal.atlassian.net/wiki/spaces/NEST/pages/629506332/Secure+Connection+to+External+Kafka+Brokers+via+SSL) Confluence page.

## Set TLS Secret for external certificates

The set up is described on [FCENGX-4414 - External Certificate Management in 9.4 NetReveal Helm Chart](https://netreveal.atlassian.net/wiki/spaces/NEST/pages/695371321/FCENGX-4414+-+External+Certificate+Management+in+9.4+NetReveal+Helm+Chart) Confluence page.

## Set TLS Secret for Kafka-UI

### Create Kafka-UI Ingress Certificate
*Change the path to the private and public keys to the location where your keys are, and change the key names to appropriate values*
```bash
kubectl -n $APP_NAMESPACE create secret tls kafka-ui-certs --key=$kafka-ui-key.pem --cert=$kafka-ui-cert.pem
```

## Set TLS Secrets for Keycloak

### Create Keycloak Ingress Certificate

*Change the path to the private and public keys to the location where your keys are, and change the key names to appropriate values*

```bash
kubectl -n $APP_NAMESPACE create secret tls keycloak-ui-certs --key=$keycloak-ui-key.pem --cert=$keycloak-ui-cert.pem
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

*In case regcred secret has to be refreshed it has to be deleted before:*

```bash
kubectl -n <PROPER-NAMESPACE> delete secret regcred
```

## Set environment variables for sensitive data

#### Export the required environment variables as defined in the secret store

The secrets store could be 1Password, AWS SSM, etc.:

```bash
export AAP_ADMIN_PASSWORD="<value>"
export AAP_JDBC_PASSWORD="<value>"
export CLIENT_SUBDOMAIN="<value>"
export DB_LICENCE_KEY="<value>"
export ENV_TYPE="<value>"
export FACTIVA_USER_PASSWORD="<value>"
export INGRESS_WILDCARD_DNS="<value>"
export KAFKA_UI_PASSWORD="<value>"
export KAFKA_UI_TLS_PRIVATE_KEY="<value>"
export KAFKA_UI_TLS_PUBLIC_KEY="<value>"
export KEYCLOAK_ADMIN_PASSWORD="<value>"
export KEYCLOAK_DB_USER_PASSWORD="<value>"
export KEYCLOAK_ENABLE="<value>"
export MINIO_CLIENT_PASSWORD="<value>"
export MINIO_PASSWORD="<value>"
export MINIO_PSQL_PASSWORD="<value>"
export MINIO_TLS_PRIVATE_KEY="<value>"
export MINIO_TLS_PUBLIC_KEY="<value>"
export ORGUNIT_1_PASSWORD="value"
export ORGUNIT_2_PASSWORD="value"
export NR_KEYSTORE_KEY_PASSWORD="<value>"
export NR_KEYSTORE_PASSWORD="<value>"
export OPENSEARCH_INTERNAL_USER="<value>"
export POSTGRES_AAP_USER_PASSWORD="<value>"
export POSTGRES_ENTRES_PASSWORD="<value>"
export POSTGRES_SUPERUSER_PASSWORD="<value>"
export POSTGRES_USER_PASSWORD="<value>"
export POSTGRES_IMPORT_USER_PASSWORD="<value>"
export SAML_ENABLE="<value>"
export SENSAAI_ADMIN_PASSWORD="<value>"
export TRUST_STORE_PASSWORD="<value>"
export WORLDCHECK_USER_PASSWORD="<value>"

```


Replace \<value\> with the corresponding values

## Helm deployment of Infra Common and Netreveal charts

### Add dependency repos
```bash
helm repo add stakater https://stakater.github.io/stakater-charts
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add spark-operator https://kubeflow.github.io/spark-operator
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add cloudnative-pg https://cloudnative-pg.github.io/charts
helm repo add datashim https://datashim-io.github.io/datashim
helm repo add minio https://operator.min.io/
helm repo add jetstack https://charts.jetstack.io
helm repo add opensearch https://opensearch-project.github.io/helm-charts
helm repo add emberstack https://emberstack.github.io/helm-charts
helm repo add argo https://argoproj.github.io/argo-helm
```

### Commands to handle dependencies
```bash
helm dependency build nr-infra-common
helm dependency build netreveal
```

### Deploy nr-infra-common chart
*AKS Example.*
*For other environments use proper values file params-nr-\<ENVIRONMENT-TYPE\>-v93.yaml*
*If you are deploying to the cluster where Ivenstigation Hub product is already deployed their infra chart, do not install this chart. [Currently, if InvestigationHub infra is deployed in the cluster, NR charts won't work because we have several operators that are not included in InvestigationHub infra charts]*

```bash
helm upgrade --install --namespace nr-infra-common nr-infra-common nr-infra-common -f params-nr-nrod.yaml
```

### Deploy Netreveal using Helm
*AKS Example.*
*For other environments use proper values file params-nr-\<ENVIRONMENT-TYPE\>-v93.yaml*

```bash
helm upgrade \
    --install \
    --timeout 25m \
    --namespace $APP_NAMESPACE \
    $APP_RELEASE_NAME \
    netreveal \
    -f params-nr-nrod.yaml \
    --set "aap.aap.admin_password=$AAP_ADMIN_PASSWORD" \
    --set "aap.jdbc.password=$AAP_JDBC_PASSWORD" \
    --set "global.baseConfigProperties.clusterdb.AapsparkuserPassword=$POSTGRES_AAP_USER_PASSWORD" \
    --set "global.baseConfigProperties.clusterdb.AppPassword=$POSTGRES_USER_PASSWORD" \
    --set "global.baseConfigProperties.clusterdb.nrImportUserPassword=$POSTGRES_IMPORT_USER_PASSWORD" \
    --set "global.baseConfigProperties.clusterdb.EntresPassword=$POSTGRES_ENTRES_PASSWORD" \
    --set "global.baseConfigProperties.clusterdb.PostgresPassword=$POSTGRES_SUPERUSER_PASSWORD" \
    --set "global.clientSubDomain=$CLIENT_SUBDOMAIN" \
    --set "global.dockerRegistryName=$DOCKER_REGISTRY" \
    --set "global.envType=$ENV_TYPE" \
    --set "global.grafanaNamespace=$MONITORING_NAMESPACE" \
    --set "global.ingressWildCardDns=$INGRESS_WILDCARD_DNS" \
    --set "global.minio.clientPassword=$MINIO_CLIENT_PASSWORD" \
    --set "global.minio.password=$MINIO_PASSWORD" \
    --set "global.nrOrgUnits[0].userPassword=${ORGUNIT_1_PASSWORD},global.nrOrgUnits[1].userPassword=${ORGUNIT_2_PASSWORD}" \
    --set "global.minio.psqlPassword=$MINIO_PSQL_PASSWORD" \
    --set "global.namespace=$APP_NAMESPACE" \
    --set "global.prometheus.release=$APP_RELEASE_NAME" \
    --set global.nrSubChartSwitches.enableKeycloak=$KEYCLOAK_ENABLE \
    --set global.saml.enabled=$SAML_ENABLE \
    --set "global.trustStore.password=$TRUST_STORE_PASSWORD" \
    --set "kafka-ui.envs.secret.SPRING_SECURITY_USER_PASSWORD=$KAFKA_UI_PASSWORD" \
    --set "kube-prometheus-stack.grafana.namespaceOverride=$MONITORING_NAMESPACE" \
    --set "kube-prometheus-stack.kube-state-metrics.namespaceOverride=$MONITORING_NAMESPACE" \
    --set "kube-prometheus-stack.namespaceOverride=$MONITORING_NAMESPACE" \
    --set "kube-prometheus-stack.prometheus-node-exporter.namespaceOverride=$MONITORING_NAMESPACE" \
    --set "nrodsftp.global.PASSWORD=$MINIO_PASSWORD" \
    --set "opensearch-extras.secret.hash=$OPENSEARCH_INTERNAL_USER" \
    --set "rtde.keystore.key_password=$NR_KEYSTORE_KEY_PASSWORD" \
    --set "rtde.keystore.password=$NR_KEYSTORE_PASSWORD" \
    --set "rtde.namespaceOverride=$APP_NAMESPACE" \
    --set "smbd.keystore.key_password=$NR_KEYSTORE_KEY_PASSWORD" \
    --set "smbd.keystore.password=$NR_KEYSTORE_PASSWORD" \
    --set "spark-operator.image.repository=$DOCKER_REGISTRY/$SPARK_OPERATOR_DOCKER_NAME" \
    --set "spark-operator.podAnnotations.restart-after/upgrade=$(uuidgen)" \
    --set "spark-operator.sparkJobNamespace=$APP_NAMESPACE" \
    --set spark-operator.sparkJobNamespaces[0]="$APP_NAMESPACE" \
    --set "standalone.dbInit.licence.licenceKey=$DB_LICENCE_KEY" \
    --set "standalone.factiva.factivaParameters.password=$FACTIVA_USER_PASSWORD" \
    --set "standalone.worldcheck.worldcheckParameters.password=$WORLDCHECK_USER_PASSWORD" \
    --set-string global.useImagePullSecrets="$USE_GLOBAL_PULL_SECRETS" \
    --set "keycloak.auth.adminPassword=$KEYCLOAK_ADMIN_PASSWORD" \
    --set "global.baseConfigProperties.clusterdb.KeycloakPassword=$KEYCLOAK_DB_USER_PASSWORD" \
    --set "sensaai-sanctions.users.admin.pass=$SENSAAI_ADMIN_PASSWORD"
```

**spark-operator.sparkJobNamespaces[0]** property has been added in version **1.0.10**.

**spark-operator.sparkJobNamespace** property has been deprecated in version **1.0.10**.


The multi-org properties can be defined also with multi line set up:

```bash
    --set "global.nrOrgUnits[0].userPassword=${ORGUNIT_1_PASSWORD}" \
    --set "global.nrOrgUnits[1].userPassword=${ORGUNIT_2_PASSWORD}" \
```

## Clean Up

❗Be careful, these steps will also destroy the persistent volumes containing the data❗

### Delete the deployment and associated resources

```bash
helm uninstall --namespace $APP_NAMESPACE $APP_RELEASE_NAME
kubectl -n ${APP_NAMESPACE} get kafkatopic -o name | xargs -n 1 kubectl -n ${APP_NAMESPACE} patch  -p '{"metadata":{"finalizers":[]}}' --type=merge
kubectl delete ns $APP_NAMESPACE
kubectl delete ns $MONITORING_NAMESPACE
```

### Full deletion, including common infra resources

❗Note that if you have multiple netreveal replicas in your cluster, each replica will stop working because nr-infra-common is a cluster-wide resource.❗

```bash
helm uninstall --namespace nr-infra-common nr-infra-common
kubectl delete ns nr-infra-common
kubectl patch crd datasetsinternal.datashim.io  -p '{"metadata":{"finalizers":[]}}' --type=merge
kubectl delete crd $(kubectl get crds -o json | jq -r ' .items[] | .metadata.name' | grep -E 'monitoring.coreos.com|sparkoperator.k8s.io|strimzi.io|postgresql.cnpg.io|datashim.io')
```

## Parameters

### Global Parameters

**TODO**

### Common Parameters

**TODO**
