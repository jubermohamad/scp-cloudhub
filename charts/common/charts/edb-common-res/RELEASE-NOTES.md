## 2.1.0
This release is incompatible with NetReveal 9.4 and 9.5 because the Strimzi Operator has been upgraded to 0.50.1, which no longer supports Kafka 3.9.0 and Kafka cannot be upgraded within NetReveal 9.4 and 9.5. That common-res will be compatible with nrod-9.6 from version 3.0.5 where Kafka 4.0.0 is available.

- [SCP-5547](https://netreveal.atlassian.net/browse/SCP-5547) - Upgrade cert-manager from 1.19.3 to 1.19.4
- [SCP-5548](https://netreveal.atlassian.net/browse/SCP-5548) - Upgrade reloader from 2.2.7 to 2.2.8
- [SCP-5559](https://netreveal.atlassian.net/browse/SCP-5559) - Upgrade Strimzi operator from 0.47.0 to 0.50.1
  New Strimzi operator supports Kafka from 4.0.0. Make sure that Kafka clusters that are deployed on the Kubernetes cluster are within the supported range before running the common-res upgrade to 2.1.0+. You can verify it with:
  `kubectl get kafkas.kafka.strimzi.io -A -o yaml | grep -E "version|image"`

  Upgrading the Strimzi Cluster Operator causes a rolling update of all Kafka clusters it manages. For topics configured with high availability (replication factor of at least 3 and evenly distributed partitions), the upgrade process should not cause any downtime for consumers and producers.

  The Helm upgrade command does not upgrade the Strimzi Custom Resource Definitions. Install the new CRDs manually after upgrading the Cluster Operator. You can download the CRDs from the GitHub releases page <https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.50.1> or find them in the `crd` subdirectory inside the Helm Chart. They can be applied with:
  `kubectl apply -f strimzi-crds-0.50.1.yaml`
- [SCP-5547](https://netreveal.atlassian.net/browse/SCP-5547) - Upgrade argo-workflows from 0.47.3 to 0.47.4

## 2.0.1

- [SCP-5780](https://netreveal.atlassian.net/browse/SCP-5780) - Parameterize volumeBindingMode and reclaimPolicy for managed-csi-xfs-standardssd-lrs StorageClass<br>
  The default values for volumeBindingMode and reclaimPolicy are set to WaitForFirstConsumer and Retain, respectively for backwards compatibility. Users can override these defaults by providing their own values in the common-res chart configuration.<br>
  Those parameters are immutable, so changing them requires deleting and recreating the StorageClass on the cluster. It will not cause downtime for existing workloads, and it will not affect existing PVs created from the StorageClass, so deleting the StorageClass is safe.

## 2.0.0
This release is incompatible with NetReveal 9.4 because the Strimzi Operator has been upgraded to 0.47.0, which no longer supports Kafka 3.8.0 and Kafka cannot be upgraded within NetReveal 9.4.

- [SCP-5089](https://netreveal.atlassian.net/browse/SCP-5089) - Upgrade cert-manager from 1.12.17 to 1.19.3
- [SCP-5129](https://netreveal.atlassian.net/browse/SCP-5129) - Upgrade ingress-nginx controller from 4.11.5 to 4.14.3
- [SCP-5116](https://netreveal.atlassian.net/browse/SCP-5116) - Upgrade CloudnativePG operator from 0.26.1 to 0.27.1<br>
  All Postgres pods in the cluster will be restarted, starting with the replicas one at a time. The primary is upgraded and restarted last, without a switchover. In-place updates can be enabled on the primary with `ENABLE_INSTANCE_MANAGER_INPLACE_UPDATES=true` (disabled by default).

  Plan downtime. In internal environments, it took around 5 minutes, but the database sizes were not significant.
- [SCP-5104](https://netreveal.atlassian.net/browse/SCP-5104) - Upgrade reloader from 1.0.63 to 2.2.7
- [SCP-5102](https://netreveal.atlassian.net/browse/SCP-5102) - Upgrade Strimzi operator from 0.45.1 to 0.47.0<br>
  New Strimzi operator supports Kafka 3.9.0, 3.9.1, 4.0.0. Make sure that Kafka clusters that are deployed on the Kubernetes cluster are within the supported range before running the common-res upgrade to 2.0.0+. You can verify it with:
  `kubectl get kafkas.kafka.strimzi.io -A -o yaml | grep -E "version|image"`

  Upgrading the Strimzi Cluster Operator causes a rolling update of all Kafka clusters it manages. For topics configured with high availability (replication factor of at least 3 and evenly distributed partitions), the upgrade process should not cause any downtime for consumers and producers.

  The Helm upgrade command does not upgrade the Strimzi Custom Resource Definitions. Install the new CRDs manually after upgrading the Cluster Operator. You can download the CRDs from the GitHub releases page <https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.47.0> or find them in the `crd` subdirectory inside the Helm Chart. They can be applied with:
  `kubectl apply -f strimzi-crds-0.47.0.yaml`
- [SCP-5117](https://netreveal.atlassian.net/browse/SCP-5117) - Upgrade argo-workflows from 0.40.11 to 0.47.3
- [SCP-5176](https://netreveal.atlassian.net/browse/SCP-5176) - Upgrade skupper from 2.1.1 to 2.1.3

## 1.6.0

- [SCP-4404](https://netreveal.atlassian.net/browse/SCP-4404) - NetReveal Containers to Have the Option for Using EDB instead of CNPG

  This version adds an option to deploy EDB and Scupper, which are required for NR 9.6 Active-Active deployments. The EDB Operator cannot be deployed together with CNPG, as it includes its own cert-manager. Therefore, both CNPG and cert-manager must be disabled when deploying EDB. To support this deployment scenario, the __params-common-res-edb.yaml__ file has been created with the required changes to deploy the EDB and Scupper Operators.
  The EDB Operator requires two additional properties:

  ```
  edb-postgres-distributed-for-kubernetes:
    image:
      imageCredentials:
        username: "k8s_enterprise"
        password: ""
  ```

## 1.5.1

- [SCP-5780](https://netreveal.atlassian.net/browse/SCP-5780) - Parameterize volumeBindingMode and reclaimPolicy for managed-csi-xfs-standardssd-lrs StorageClass<br>
  The default values for volumeBindingMode and reclaimPolicy are set to WaitForFirstConsumer and Retain, respectively for backwards compatibility. Users can override these defaults by providing their own values in the common-res chart configuration.<br>
  Those parameters are immutable, so changing them requires deleting and recreating the StorageClass on the cluster. It will not cause downtime for existing workloads, and it will not affect existing PVs created from the StorageClass, so deleting the StorageClass is safe.


## 1.5.0

- [SCP-3554](https://netreveal.atlassian.net/browse/SCP-3554) - Upgrade Strimzi operator from 0.44.0 to 0.45.1.
  It supports Kafka 3.8.0, 3.8.1, 3.9.0, 3.9.1. Make sure that Kafka clusters that are deployed on the Kubernetes cluster are within the supported range before running the common-res upgrade to 1.5.0+. You can verify it with:
  `kubectl get kafkas.kafka.strimzi.io -A -o yaml | grep -E "version|image"`

  Upgrading the Strimzi Cluster Operator causes a rolling update of all Kafka clusters it manages. For topics configured with high availability (replication factor of at least 3 and evenly distributed partitions), the upgrade process should not cause any downtime for consumers and producers.

  The helm upgrade command does not upgrade the Strimzi Custom Resource Definitions. We need to install the new CRDs manually after upgrading the Cluster Operator. You can download the CRDs from the GitHub releases page https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.45.1 or find them in the crd subdirectory inside the Helm Chart. They can be applied with:
  `kubectl apply -f strimzi-crds-0.45.1.yaml`

## 1.4.0

- [SCP-2318](https://netreveal.atlassian.net/browse/SCP-2318) - Upgrade CloudnativePG operator from 0.20.0 to 0.26.1.
  All Postgres pods in the cluster will be restarted, starting with the replicas one at a time. The primary is upgraded and restarted last, without a switchover, even if in-place updates are enabled on the primary with `ENABLE_INSTANCE_MANAGER_INPLACE_UPDATES=true`.

  Downtime needs to be planned. In internal environments, it took around 5 minutes, but the database sizes were not significant.

## 1.3.0

- [SCP-2288](https://netreveal.atlassian.net/browse/SCP-2288) - Upgrade MinIO operator from 5.0.11 to 5.0.18.
  All MinIO pods on the cluster will be restarted, there should be no downtime for consumers due to Pod Disruption Budgets.

## 1.2.0

- [SCP-3505](https://netreveal.atlassian.net/browse/SCP-3505) - SCP common-res Helm chart update for jetstack-cert-manager to v1.12.17

## 1.1.1

- [SCP-5780](https://netreveal.atlassian.net/browse/SCP-5780) - Parameterize volumeBindingMode and reclaimPolicy for managed-csi-xfs-standardssd-lrs StorageClass<br>
  The default values for volumeBindingMode and reclaimPolicy are set to WaitForFirstConsumer and Retain, respectively for backwards compatibility. Users can override these defaults by providing their own values in the common-res chart configuration.<br>
  Those parameters are immutable, so changing them requires deleting and recreating the StorageClass on the cluster. It will not cause downtime for existing workloads, and it will not affect existing PVs created from the StorageClass, so deleting the StorageClass is safe.


## 1.1.0

- [SCP-2319](https://netreveal.atlassian.net/browse/SCP-2319) - Upgrade Strimzi operator for Kafka from 0.40.0 to 0.44.0. It supports Kafka 3.7.0, 3.7.1, 3.8.0. Make sure that Kafka clusters that are deployed on the Kubernetes cluster are within the supported range before running the common-res upgrade to 1.1.0+. You can verify it with:
  `kubectl get kafkas.kafka.strimzi.io -A -o yaml | grep -E "version|image"`
  Upgrading the Strimzi Cluster Operator causes a rolling update of all Kafka clusters it manages. For topics configured with high availability (replication factor of at least 3 and evenly distributed partitions), the upgrade process should not cause any downtime for consumers and producers.

## 1.0.10

- [SCP-5780](https://netreveal.atlassian.net/browse/SCP-5780) - Parameterize volumeBindingMode and reclaimPolicy for managed-csi-xfs-standardssd-lrs StorageClass<br>
  The default values for volumeBindingMode and reclaimPolicy are set to WaitForFirstConsumer and Retain, respectively for backwards compatibility. Users can override these defaults by providing their own values in the common-res chart configuration.<br>
  Those parameters are immutable, so changing them requires deleting and recreating the StorageClass on the cluster. It will not cause downtime for existing workloads, and it will not affect existing PVs created from the StorageClass, so deleting the StorageClass is safe.


## 1.0.9

### Upgrade Path

1. After this version is applied, the **_ingress-nginx-controller-\*_** POD(s) have to be restarted.

- [FCENGX-4668](https://netreveal.atlassian.net/browse/FCENGX-4668) - Update X-Frame-Options Header to SAMEORIGIN in Ingress-NGINX for iframe Compatibility

## 1.0.8

- [FCENGX-4619](https://netreveal.atlassian.net/browse/FCENGX-4619) - Allow inheriting "app.kubernetes.io/\*" labels into PostgreSQL PODs.

## 1.0.7

- [SCP-1023](https://netreveal.atlassian.net/browse/SCP-1023) - Upgrade Ingress-NGINX version from v1.10.0 to v1.11.5 to address IngressNightmare vulnerabilities.

## 1.0.6

### New Properties

```yaml
storageclass:
  storageClass:
    enable:
      scAzureNetapFiles: true
      scAzureNfs: true
      scXfsStandardssdLrs: true
```

- Added properties to have an option to skip StorageClass creation.
- [FCENGX-3942](https://netreveal.atlassian.net/browse/FCENGX-3942) - Common-res - Remove pg_settings section from cloudnative-pg.monitoringQueriesConfigMap.queries

## 1.0.5

- [FCENGX-3853](https://netreveal.atlassian.net/browse/FCENGX-3853) - Ingress-nginx controller not propagating metrics to Prometheus and then DataDog.
