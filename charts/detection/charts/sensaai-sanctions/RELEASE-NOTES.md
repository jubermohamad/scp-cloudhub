# Release Notes

## 2.0.14
* Bumped S4S version to 9.6.1.5
* Updated the values files to include new S4S properties

## 2.0.13
* Bumped S4S version to 9.6.1.4

## 2.0.12
* Bumped S4S version to 9.6.1.1

## 2.0.11
* Bumped S4S version to 9.6.0.5

## 2.0.10
* Bumped S4S version to 9.6.0.2
* Changed English Spacy model from "..._trf" to "..._lg"
* Upgraded MinIO and mc versions

### Upgrade path
As part of the **WLM-4124** the English Spacy model was changed from "..._trf" to "..._lg". The models are referenced in the 'SPACY_MODEL' and 'SPACY_MODELS' config properties, so these should be changed and _trf should be substituted with _lg for the English versions. Retraining the S4S model after this change is recommended.

## 2.0.9
* Bumped S4S version to 9.6.0.0
* Increased training instance ingress proxy body size to 100m
### Upgrade path

As part of the **WLM-3983** new property has been added **_global.useCertManager_**. This property has to be defined as **_false_** in case **_cert-manager_** operator is not present on the cluster or secret containing certificates has to be created without use of the **_cert-manager_**. When **_global.useCertManager=false_** then the **<release-name>-sensaai-sanctions-cert** secret has to be created before the S4S deployment is run:

```bash
kubectl --context <context> -n <namespace> create secret tls <release-name>-sensaai-sanctions-cert --key=tls.key --cert=tls.crt
```

* [WLMX-3983](https://netreveal.atlassian.net/browse/WLMX-3983) - Make cert-manager operator optional

## 2.0.8
* Bumped S4S version to 9.6.0.0-a9
* Increased resources for the training pod

## 2.0.7
* Bumped S4S version to 9.6.0.0-a8
* Fixed an issue with hardcoded namespaces

## 2.0.6
* Bumped S4S version to 9.6.0.0-a7
* Added new /getBatchMatchScore endpoint to the inference pods

## 2.0.5

### Upgrade path

As part of WLMX-3684, the `sensaai-sanctions` chart has been renamed to `sensaai-sanctions-inference`. This change may require updates to the properties paths.

As part of WLMX-3415, a new child service `sensaai-sanctions-training` has been added. This service is responsible for training the SensaAI for Sanctions (S4S) models. This change may require adding new properties.

### Changes
* [WLMX-3684](https://netreveal.atlassian.net/browse/WLMX-3684) - Renamed sensaai-sanctions subchart to sensaai-sanctions-inference to better reflect its purpose.
* [WLMX-3415](https://netreveal.atlassian.net/browse/WLMX-3415) - Added `sensaai-sanctions-training` as a new child service.
* Bumped the chart version to 2.0.5.

## 2.0.4

* Bumped the S4S version to 9.6.0.0-a4
* Parametrise the Secret name with MinIO user/password in the sensaai-sanctions chart.
* Fix function creating Secret with S4S user(s) set up.
* Increase default resource limits and resources for the S4S PODs.

## 2.0.3

* [FCENGX-4188](https://netreveal.atlassian.net/browse/FCENGX-4188) - Upgrade non-NR S4S to 9.5.0.1
* Disable the possibility to create user with empty password

## 2.0.2

* [FCENGX-3797](https://netreveal.atlassian.net/browse/FCENGX-3797) - Upgrade non-NR S4S to 9.5.0.0-a8

**Upgrade Path Note**: Models trained with older versions of S4S are not compatible with the current version. Therefore, the current version must be deployed as a fresh installation. More details can be found on the S4S [Release Page](https://netreveal.atlassian.net/wiki/spaces/HARMONY/pages/199884897/Releases).

## 2.0.1

* [FCENGX-3662](https://netreveal.atlassian.net/browse/FCENGX-3662) - Use Minio as storage for S4S to enable Velero backups

New environment variables have been added:

  "MINIO_CLIENT_PASSWORD"
  "MINIO_PASSWORD"

```bash
  helm upgrade \
    --install \
    --timeout 25m \
    --namespace "$APP_NAMESPACE" \
    "$APP_RELEASE_NAME" \
    "./sensaai-sanctions" \
    -f "$FILE_NAME" \
    --set-string global.dockerRegistryName="$DOCKER_REGISTRY" \
    --set-string global.envType="$ENV_TYPE" \
    --set-string global.ingressWildCardDns="$INGRESS_WILDCARD_DNS" \
    --set-string global.minio.password="$MINIO_PASSWORD" \
    --set-string global.minio.clientPassword="$MINIO_CLIENT_PASSWORD" \
    --set-string global.namespace="$APP_NAMESPACE" \
    --set-string global.useImagePullSecrets="$USE_GLOBAL_PULL_SECRETS" \
    --set-string sensaai-sanctions.users.admin.pass="$ADMIN_PASSWORD" \
    --set-string sensaai-sanctions.users.sai-admin.pass="$SAI_ADMIN_PASSWORD"
```

* [FCENGX-3423](https://netreveal.atlassian.net/browse/FCENGX-3423) - SensaAI for Sanctions (S4S) Egress filtering and management

## 2.0.0

* [FCENGX-3488](https://netreveal.atlassian.net/browse/FCENGX-3488) - Containerize API Capable S4S for Abanca

> Note:
>
> In this version has been added new System Variable to pass the password for the **sai-admin** (user defined with _admin_ role).
> This means also the update made to the _helm upgrade_ command:

```bash
  helm upgrade \
    --install \
    --timeout 25m \
    --namespace "$APP_NAMESPACE" \
    "$APP_RELEASE_NAME" \
    "./sensaai-sanctions" \
    -f "$FILE_NAME" \
    --set-string global.dockerRegistryName="$DOCKER_REGISTRY" \
    --set-string global.envType="$ENV_TYPE" \
    --set-string global.ingressWildCardDns="$INGRESS_WILDCARD_DNS" \
    --set-string global.namespace="$APP_NAMESPACE" \
    --set-string global.useImagePullSecrets="$USE_GLOBAL_PULL_SECRETS" \
    --set-string sensaai-sanctions.users.admin.pass="$ADMIN_PASSWORD" \
    --set-string sensaai-sanctions.users.sai-admin.pass="$SAI_ADMIN_PASSWORD"
```
