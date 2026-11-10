## 1.0.23

### Component versions

* AAP - **9.5.0.1**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* Kafka - **3.8.0**
* NetReveal Platform - **9.4.0.35**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.6.0.3** on Spark **3.5.6** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.6.0.4** on Spark **3.5.6** (**jdk17**)

### Functional changes
* Upgrade RTDE version to **9.6.0.3**.

### Bug fixes
* [SCP-5891](https://netreveal.atlassian.net/browse/SCP-5891) Replace flaky s3fs mounts with minio cli for copying files to and from the public bucket in standalone pod

### Security fixes
* [SCP-5891](https://netreveal.atlassian.net/browse/SCP-5891) Port standalone pod hardening - disable service account token automounting, disable privilege escalation, run as non-root user, set read-only root filesystem, remove SYS_ADMIN capability

## 1.0.22

### Component versions

* AAP - **9.5.0.1**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* Kafka - **3.8.0**
* NetReveal Platform - **9.4.0.35**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.6.0.2** on Spark **3.5.6** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.6.0.4** on Spark **3.5.6** (**jdk17**)

### Upgrade path
As part of **SCP-4520** the platform version has been upgraded from 9.4.0.24 to 9.4.0.35. The automatic platform upgrade is not done so this had to be by use of the overlay configuration. More details can be found on this Confluence Page: [SCP-4520 - Platform upgrade from version 9.4.0.24 to 9.4.0.35 (NR 1.0.21 upgrade to NR 1.0.22)](https://netreveal.atlassian.net/wiki/spaces/NEST/pages/1274478909/SCP-4520+-+Platform+upgrade+from+version+9.4.0.24+to+9.4.0.35+NR+1.0.21+upgrade+to+NR+1.0.22).

### Functional changes
* [SCP-4520](https://netreveal.atlassian.net/browse/SCP-4520) - Upgrade NetReveal Platform to **9.4.0.35**
* Upgrade RTDE version to **9.6.0.2**
* Upgrade SMBD version to **9.6.0.4**
* [SCP-4262](https://netreveal.atlassian.net/browse/SCP-4262) - Configure Swift MT Linking Job for Single Proc Node Execution


### Bug fixes

* [SCP-4490](https://netreveal.atlassian.net/browse/SCP-4490) - Containerisation Support Request -  Fix for zeppelin ingress, setting HTTP protocol for backend zeppelin protocol
* [SCP-4635](https://netreveal.atlassian.net/browse/SCP-4490) - Containerisation Support Request -  Fix for Error deploying Zeppelin to Second Environment
### Security fixes

## 1.0.21

### Component versions

* AAP - **9.5.0.1**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* Kafka - **3.8.0**
* NetReveal Platform - **9.4.0.24**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.5.0.4** on Spark **3.5.6** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.5.0.4** on Spark **3.5.6** (**jdk17**)

### Upgrade path

As part of [SCP-2328](https://netreveal.atlassian.net/browse/SCP-2328), an option to deploy Zeppelin has been added. Authentication is enabled by default, and user passwords can be left empty to auto-generate secure passwords:

```yaml
zeppelin-server:
  auth:
    enabled: true
    users:
      - username: "admin"
        password: ""  # Leave empty to auto-generate on first install (persists across upgrades)
        roles: "admin"
      - username: "user"
        password: ""  # Leave empty to auto-generate on first install (persists across upgrades)
        roles: "user"
```

Passwords are automatically generated and stored in the **zeppelin-shiro-config** secret, which contains both the Shiro configuration and individual password data fields. This secret persists across Helm upgrades to ensure password stability.

To retrieve passwords after deployment:
```bash
kubectl get secret zeppelin-shiro-config --context <context> -n <namespace> -o jsonpath='{.data.admin}' | base64 -d
```

The profiles are linked into **_/opt/smbd-\<domain\>/profile_storage_** folder. For example **_/opt/smbd-aml/profile_storage_**.

**Notebook Persistence**: Zeppelin notebooks are persisted on a PersistentVolumeClaim to ensure imported notebooks survive pod restarts. Persistence is enabled by default and can be configured:

```yaml
zeppelin-server:
  persistence:
    enabled: true
    storageClassName: ""  # Use default storage class if empty
    accessMode: ReadWriteOnce
    size: 10Gi
```

### Functional changes
* [SCP-3554](https://netreveal.atlassian.net/browse/SCP-3554) - Upgrade Kafka cluster from version 3.7 to 3.8.
* [SCP-2328](https://netreveal.atlassian.net/browse/SCP-2328) - Zeppelin tool with NetReveal deployments to allow internal teams to query SMBD profiles


### Bug fixes
* [SCP-4205](https://netreveal.atlassian.net/browse/SCP-4205) - Override fts in nr-ui is incorrect

### Security fixes

## 1.0.20

### Component versions

* AAP - **9.5.0.1**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* Kafka - **3.7.0**
* NetReveal Platform - **9.4.0.24**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.5.0.4** on Spark **3.5.6** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.5.0.4** on Spark **3.5.6** (**jdk17**)

### Upgrade path
* [SCP-3527](https://netreveal.atlassian.net/browse/SCP-3527) - Containerisation Support Request -  Remove lock files mechanism from dbExtract script.
Export zip file name convention has changed from ZIP_FILE_NAME=OptionalFilename into ZIP_FILE_NAME=OptionalFilename_TypeOfExtract eg. Before ZIP_FILE_NAME=netreveal_20251112_091023.zip, Now ZIP_FILE_NAME=netreveal_hour_20251112_090123.zip. TypeOfExtract is mandatory field.

### Functional changes
* [SCP-4102](https://netreveal.atlassian.net/browse/SCP-4102) - Helm Chart update - PGP Encryption support for multiple client public keys for MultiOrg
* [SCP-3909](https://netreveal.atlassian.net/browse/SCP-3909) - Containerisation Support Request - WLM RT 0-downtime on nrodv2

### Bug fixes
* [SCP-3534](https://netreveal.atlassian.net/browse/SCP-3534) - Azure Support Request - Entain Minio - Standalone pod connectivity Issue-Post-Deployment Observation
* [SCP-3842](https://netreveal.atlassian.net/browse/SCP-3842) - acq_pid is not removed when standalone pod is killed during acquisition
* [SCP-3527](https://netreveal.atlassian.net/browse/SCP-3527) - Containerisation Support Request -  Remove lock files mechanism from dbExtract script
* [SCP-2811](https://netreveal.atlassian.net/browse/SCP-2811) - Containerisation Support Request -  Fix for script which moves feedback acqusitions files to public-bucket

### Security fixes

## 1.0.19

### Component versions

* AAP - **9.5.0.0**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.24**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.5.0.4** on Spark **3.5.6** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.5.0.4** on Spark **3.5.6** (**jdk17**)

### Functional changes
* [SCP-2904](https://netreveal.atlassian.net/browse/SCP-2904) - Unauthenticated calls to dockerhub in charts
* [SCP-3594](https://netreveal.atlassian.net/browse/SCP-3594) - Add timestamp to bad zip to avoid overwriting
* [SCP-2557](https://netreveal.atlassian.net/browse/SCP-2557) - Upgrade spark to version 3.5.6 and SMBD/RTDE to versions 9.5.0.4
* [SCP-2376](https://netreveal.atlassian.net/browse/SCP-2376) - Remove the dependency on s3fs Daemon Set from NetReveal containers.

### Bug fixes
* [SCP-3789](https://netreveal.atlassian.net/browse/SCP-3789) - Containerisation Support Request -  Internal database and sftp access lost after enabling Network Policy
* [SCP-3324](https://netreveal.atlassian.net/browse/SCP-3324) - dbextract.sh is not returning error codes on failures.

### Security fixes

## 1.0.18

### Component versions

* AAP - **9.5.0.0**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.24**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.4.0.6** on Spark **3.5.2** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.4.0.5** on Spark **3.5.2** (**jdk17**)

### Upgrade path
As part of **SCP-2487** the Docker Registry has been set up as the __symphonyfs__ ACR (__symphonysensa.azurecr.io__) instead of Docker Hub (__index.docker.io/symphonysensa__).

As part of **SCP-2657** the network policies is set as enabled by default in 9.4

### Functional changes
* [SCP-2487](https://netreveal.atlassian.net/browse/SCP-2487) - Azure Support Request - Cache Bitnami images

### Bug fixes
* [SCP-2761](https://netreveal.atlassian.net/browse/SCP-2761) - Set time zone as system parameter for dbextract and WLM import list CronJobs.
* [SCP-2677](https://netreveal.atlassian.net/browse/SCP-2677) - (NetReveal) Pods missing readiness or livenessProbe
* [SCP-2829](https://netreveal.atlassian.net/browse/SCP-2829) - Download only 1 file with factiva list.
* [SCP-2911](https://netreveal.atlassian.net/browse/SCP-2911) - Factiva Job does not handle the parameter CUSTOM_FACTIVA_FILE_PREFIX
* [SCP-2821](https://netreveal.atlassian.net/browse/SCP-2821) - dbExtract.sh repeat database query on repeatable errors

### Security fixes

## 1.0.17

### Component versions

* AAP - **9.5.0.0**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.24**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.4.0.6** on Spark **3.5.2** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.4.0.5** on Spark **3.5.2** (**jdk17**)

### Upgrade path

As part of **SCP-2327**, network policies have been updated allowing projects to grant NR database access additional external pods dynamically via global.databaseAccess properties. Please refer to the params files found in "chart" for an example using Investigation Hub. Network policies remain disabled by default in 9.4, but may change in future releases.

As part of **SCP-2460** and **SCP-2569** the platform version has been upgraded from 9.4.0.21 to 9.4.0.24. The automatic platform upgrade is not done so this had to be by use of the overlay configuration. More details can be found on this Confluence Page: [SCP-2460 | SCP-2569 - Platform upgrade from version 9.4.0.21 to 9.4.0.24 (NR 1.0.16 upgrade to NR 1.0.17)](https://netreveal.atlassian.net/wiki/spaces/NEST/pages/782828167/SCP-2460+SCP-2569+-+Platform+upgrade+from+version+9.4.0.21+to+9.4.0.24+NR+1.0.16+upgrade+to+NR+1.0.17).

### Functional changes
* [SCP-2460](https://netreveal.atlassian.net/browse/SCP-2460) - Containerisation Support Request - Zions project need NR 9.4.0.23 containerised.
* [SCP-2569](https://netreveal.atlassian.net/browse/SCP-2569) - \[Entain\]\[PROD\] Request for helm upgrade: NR Platform 9.4.0.24

### Bug fixes
* [SCP-3087](https://netreveal.atlassian.net/browse/SCP-3087) - CPNG Operator Fails to Communicate with PostgreSQL After Enabling NetworkPolicies, Preventing Proper Scaling
* [FCENGX-5025](https://netreveal.atlassian.net/browse/FCENGX-5025) - 9.4: After the 'apps' DB user password update the override job is failing because postgres-credential-apps-user-cnpg secret is not updated before.
* [SCP-2453](https://netreveal.atlassian.net/browse/SCP-2453) - Create timeZone property for CronJobs and CronWorkflows

### Security fixes
* [SCP-2327](https://netreveal.atlassian.net/browse/SCP-2327) - Enable Network policies

## 1.0.16

### Component versions

* AAP - **9.5.0.0**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.21**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.4.0.6** on Spark **3.5.2** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.4.0.5** on Spark **3.5.2** (**jdk17**)

### Upgrade path

As part of **FCENGX-4970** the platform version has been upgraded from 9.4.0.14 to 9.4.0.21. The automatic platform upgrade is not done so this had to be by use of the overlay configuration. More details can be found on this Confluence Page: [FCENGX-4970 - Platform upgrade from version 9.4.0.14 to 9.4.0.21](https://netreveal.atlassian.net/wiki/spaces/NEST/pages/744849917/FCENGX-4970+-+Platform+upgrade+from+version+9.4.0.14+to+9.4.0.21).

As a part of FCENGX-4923 for dbExtract, new column db_schema is added to automated_exports table. More details about dbExtract and export from other schema you can read here: https://netreveal.atlassian.net/wiki/spaces/NEST/pages/388792429/Automated+Exports+of+NetReveal+Database+Extracts#Export-data-from-different-schemas-(version-1.0.16%2C-2.0.2)


### Functional changes
* [FCENGX-4923](https://netreveal.atlassian.net/browse/FCENGX-4923) - Implement capability for database extracts from apps_import schema
* [FCENGX-4970](https://netreveal.atlassian.net/browse/FCENGX-4970) - Upgrade NR Platform version in 9.4 NR Helm Chart to 9.4.0.21 or later
* [FCENGX-4720](https://netreveal.atlassian.net/browse/FCENGX-4720) - 9.4: Parametrize kafka properties for all RTDE

### Bug fixes
* [FCENGX-4799](https://netreveal.atlassian.net/browse/FCENGX-4799) - NRODSFTP: After the service crash files are staying in the Public or Private bucket.

### Security fixes
* [FCENGX-4962](https://netreveal.atlassian.net/browse/FCENGX-4962) - 9.4: Remove default welcome page from WildFly configuration
* [FCENGX-4882](https://netreveal.atlassian.net/browse/FCENGX-4882) - Security vulnerability in PostgreSQL JDBC driver v42.7.4 - 42.7.6
* [FCENGX-4673](https://netreveal.atlassian.net/browse/FCENGX-4673) - Pen Test defect / vulnerability - LOW : Cookie without HttpOnly & secure flag set

## 1.0.15

### Component versions

* AAP - **9.5.0.0**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.14**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.4.0.6** on Spark **3.5.2** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.4.0.5** on Spark **3.5.2** (**jdk17**)

### Upgrade path

_**FCENGX-4649**_. RTDE executor and drivers PODS will not be restarted automatically. To have this set up propagated to PODs the RDTE instances have to be restarted.

In this release the _**nr-ui.pvc.confWlmStorage**_ property has been updated to _**50Gi**_ in _params-nr-nrod-prod-t3-nonha.yaml_ and _params-nr-nrod-prod-t3.yaml_ files. When any of these files is used in the deployment then before the upgrade to this version **NR UI** Stateful Set has to be deleted:

```bash
kubectl delete sts --cascade=orphan <STS_NAME> -n <namespace> --context <context_name>
```

---
* [FCENGX-4414](https://netreveal.atlassian.net/browse/FCENGX-4414) - External Certificate Management in 9.4 NetReveal Helm Chart
* [FCENGX-4846](https://netreveal.atlassian.net/browse/FCENGX-4846) - 9.4: unable to load large file via Minio
* [FCENGX-4687](https://netreveal.atlassian.net/browse/FCENGX-4687) - Move readme and release notes files into netreveal folder - 9.4 and 9.5 and similar change for common-res
* [FCENGX-4601](https://netreveal.atlassian.net/browse/FCENGX-4601) - Investigate nrodsftp upgrades - Vulnerabilities scan sprint 36
* [FCENGX-4649](https://netreveal.atlassian.net/browse/FCENGX-4649) - 9.4 Rtde (SparkApp) is setting some default memory when useResourceConstraints is set to false
* [FCENGX-4708](https://netreveal.atlassian.net/browse/FCENGX-4708) - Upgrade 9.4 redis to match 9.5
* [FCENGX-4705](https://netreveal.atlassian.net/browse/FCENGX-4705) - 9.4: s3fs-provisioner.livenessProbe.timeoutSeconds is not changing the value in DaemonSet set up.
* [FCENGX-4570](https://netreveal.atlassian.net/browse/FCENGX-4570) - Update Kafka UI to latest - Vulnerabilities scan sprint 36

## 1.0.14

### Component versions

* AAP - **9.5.0.0**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.14**
* SMUI - **9.4.0.3-SMC**
* RTDE - **9.4.0.6** on Spark **3.5.2** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.4.0.5** on Spark **3.5.2** (**jdk17**)

### Upgrade path

As part of **FCENGX-4457** the platform version has been upgraded from 9.4.0.4 to 9.4.0.14. The automatic platform upgrade is not done so this had to be by use of the overlay configuration. More details can be found on this Confluence Page: [Platform upgrade from version 9.4.0.4 to 9.4.0.14](https://netreveal.atlassian.net/wiki/spaces/NEST/pages/641630536/Platform+upgrade+from+version+9.4.0.4+to+9.4.0.14).

[FCENGX-4637](https://netreveal.atlassian.net/browse/FCENGX-4637) requires to have deployed common-res in version **1.0.8** to have PostgreSQL affinity working as expected. Please note that this deployment will cause a database restart. After the restart, it is necessary to verify the NR UI, Standalone WLM IGS, and AAP.

---
* [FCENGX-4637](https://netreveal.atlassian.net/browse/FCENGX-4637) - 9.4: Kafka and PostgreSQL affinity set might be not correct when global.prefixPvcWithReleaseName=false.
* [FCENGX-4631](https://netreveal.atlassian.net/browse/FCENGX-4631) - 9.4: init-standalone script issue
* [FCENGX-4457](https://netreveal.atlassian.net/browse/FCENGX-4457) - Upgrade Platform version
* [FCENGX-4608](https://netreveal.atlassian.net/browse/FCENGX-4608) - 9.4: nr-metro-preprod-nr-dpa-audit failed with OOM

## 1.0.13

### Component versions

* AAP - **9.5.0.0**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.4**
* RTDE - **9.4.0.6** on Spark **3.5.2** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.4.0.5** on Spark **3.5.2** (**jdk17**)

### Upgrade path

To take advantage of the performance increase in AAP processing, the External Connector definition named ‘AMLORCHAapConfigRun’ must be changed. The **_pipelineConfigName_** parameter should be changed to **_Default_IET_v9.5.0.0_**. Example:

```xml
        <external-connector application="" status="1">
            <name><![CDATA[ AMLORCHAapConfigRun ]]></name>
            <url><![CDATA[ [A_PR]://[AAP_HOST]:[A_P]/analytics/rest/pipeline/config/run ]]></url>
            <type><![CDATA[ com.norkom.common.connector.RESTConnector ]]></type>
            <protocol><![CDATA[ [A_PR] ]]></protocol>
            <host><![CDATA[ [AAP_HOST] ]]></host>
            <port><![CDATA[ [A_P] ]]></port>
            <user><![CDATA[ ]]></user>
            <password><![CDATA[ ]]></password>
            <parameters>
                <parameter name="requestBody" status="1">
                    <![CDATA[ { "pipelineConfigName": "Default_IET_v9.5.0.0", "parameters": { "experiment": "[profilingEndDate]", "datasetFilePath": "[smbdHome]/profile_storage/DataSet/AML_IET_Data.csv", "datasetName": "AML_IET_Data_[jobId]_[profilingEndDate]", "decisionBoundaryFScoreBeta": [AML_TM_IET_FSCORE_BETA], "decisionBoundaryPercentage": [AML_TM_IET_PERCENTAGE], "experimentToArchive": "[AML_TM_IET_EXPERIMENT_ARCHIVE_DATE]", "undersampling": [AML_TM_IET_UNDERSAMPLING], "optimizationMaxTasks": [AML_TM_IET_OPTIMIZATION_MAX_TASKS] } } ]]></parameter>
                <parameter name="httpMethod" status="1"><![CDATA[ POST ]]></parameter>
                <parameter name="miscHeaders" status="1"><![CDATA[ Cookie:vertx-web.session=[aapSessionId]; Path=/; HttpOnly; ]]>
                </parameter>
                <parameter name="requestContentType" status="1"><![CDATA[ application/json ]]></parameter>
                <parameter name="responseMimeType" status="1"><![CDATA[ application/json ]]></parameter>
                <parameter name="resultFieldNameMappings" status="1"><![CDATA[ aapPipelineJobId=pipelineJobId ]]></parameter>
            </parameters>
        </external-connector>
```

This modification has to be done by the Override configuration.

---
* [FCENGX-4515](https://netreveal.atlassian.net/browse/FCENGX-4515) - 9.4: topologyKey value showing as hostname
* [FCENGX-4513](https://netreveal.atlassian.net/browse/FCENGX-4513) - 9.4: Enable injection of client certs to connect to the kafka brokers
* [FCENGX-4540](https://netreveal.atlassian.net/browse/FCENGX-4540) - 9.4: Standalone is in Pending state when global.nrSubChartSwitches.enableSmbd = false
* [FCENGX-4546](https://netreveal.atlassian.net/browse/FCENGX-4546) - Include the java truststore into the keystore used in NetReveal 9.4 Helm Chart
* [FCENGX-4456](https://netreveal.atlassian.net/browse/FCENGX-4456) - Upgrade AAP version
* [FCENGX-4460](https://netreveal.atlassian.net/browse/FCENGX-4460) - 9.4: SMBD: AlertFeedback_app_config.conf should have defined smbd.datasource.entity.value.skipEmptyKey=true
* [FCENGX-4455](https://netreveal.atlassian.net/browse/FCENGX-4455) - Upgrade SMBD/RTDE and JDK versions

## 1.0.12

### Component versions

* AAP - **9.4.0.4**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.4**
* RTDE - **9.4.0.5** on Spark **3.5.2** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.4.0.4** on Spark **3.5.2** (**jdk17**)
---
* [FCENGX-4449](https://netreveal.atlassian.net/browse/FCENGX-4449) - 9.4: Parametrise SMBD 'smbd.datasource.entity.value.skipEmptyKey' properties.
* [FCENGX-3780](https://netreveal.atlassian.net/browse/FCENGX-3780) - Implement Database extracts using the queries from the database
* [FCENGX-4427](https://netreveal.atlassian.net/browse/FCENGX-4427) - 9.4 - Configurable HTTP max-post-size and max-threads in WildFly
* [FCENGX-4423](https://netreveal.atlassian.net/browse/FCENGX-4423) - 9.4: downloadWorldcheck script does not handle passwords correctly
* [FCENGX-4158](https://netreveal.atlassian.net/browse/FCENGX-4158) - NR PVCs should not include release names
* Fix PostgreSQL backup and restore configuration.
* [FCENGX-4393](https://netreveal.atlassian.net/browse/FCENGX-4393) - Flag files not deleted from WLM Batchwatch folder preventing processing
* S4S - Disable the possibility to create user with empty password
* [FCENGX-4223](https://netreveal.atlassian.net/browse/FCENGX-4223) - Liveness and Readiness doesn't have option to update all properties
* [FCENGX-4213](https://netreveal.atlassian.net/browse/FCENGX-4213) - For Zookeeper and Kafka there is not option to update default properties for readiness and liveness probes.
* [FCENGX-4206](https://netreveal.atlassian.net/browse/FCENGX-4206) - Metro dev - dbexport job cannot be started because of missing secret
* [FCENGX-4177](https://netreveal.atlassian.net/browse/FCENGX-4177) - The PVC 'velero.io/csi-volumesnapshot-class' annotation is not correct after "managed-csi" StorageClass was updated to "azure-netapp-files"
* [FCENGX-4054](https://netreveal.atlassian.net/browse/FCENGX-4054) - minio-provisioner job failed when Metro preprod environment was updated from MINIO 'standalone' into the 'distributed mode

## 1.0.11

### Component versions

* AAP - **9.4.0.4**
* DPA - **9.4**
* Entity Resolution - **9.4.9**
* NetReveal Platform - **9.4.0.4**
* RTDE - **9.4.0.5** on Spark **3.5.2** (**jdk17**)
* Sensa AI for Sanctions (S4S) - **9.4.0.5**
* SMBD - **9.4.0.4** on Spark **3.5.2** (**jdk17**)
---
**UPGRADE PATH**

While upgrading from older version into the **1.0.11** it might be required to import in the Overlay configuration (Standalone) such files (fix for **FCENGX-3946**)

```bash
#################################
# Requires NR in version 1.0.11
#################################
# Fix for APPSDEVX-1969
import|application|/opt/netreveal/standaloneHome/configuration/NROD-FIXES/WLM_APPSDEVX-1969_application-configuration.xml
import|workflow|/opt/netreveal/standaloneHome/configuration/NROD-FIXES/WLM_APPSDEVX-1969_workflowConfig.xml

# Fix for WLMX-2935
import|application|/opt/netreveal/standaloneHome/configuration/NROD-FIXES/EIM_WLMX-2925-application-configuration.xml
import|services|/opt/netreveal/standaloneHome/configuration/NROD-FIXES/EIM_WLMX-2925-services-configuration.xml

import|application|/opt/netreveal/standaloneHome/configuration/NROD-FIXES/CDDCPS_Change_WLMX-2925-application-configuration.xml
import|services|/opt/netreveal/standaloneHome/configuration/NROD-FIXES/CDDCPS_Change_WLMX-2925-services-configuration.xml
```

All these files are present in the **1.0.11** Standalone Docker Image so these don't have to be put into the Overlay Docker Image. After Overlay configuration is imported the NR UI and Standalone PODs have to be restarted (if this is not done automatically).

**NEW REQUIREMENT**

As part of [FCENGX-3787](https://netreveal.atlassian.net/browse/FCENGX-3787) there were added a new properties to define the Secret where there is defined the PGP Public Key required to encrypt archiving data:

```yaml
nrodsftp:
  nrodsftp:
    # Enable/disable archiving feature.
    archivingEnabled: false
    archivingPgpPublicKey:
      secretName: "nrodsftp-archiving-pgp-key"
      secretKey: "public-key"
```

The secret can be created with use of such command (path to the pgp key is just an example):

```bash
kubectl -n $APP_NAMESPACE create secret generic nrodsftp-archiving-pgp-key --from-file=public-key=/home/klu4ic/
```

The new Secret has to be defined when **_nrodsftp.nrodsftp.archivingEnabled_** property is set to **_true_**.

* [FCENGX-4163](https://netreveal.atlassian.net/browse/FCENGX-4163) - Restart RTDE PODs after related ConfigMap or Secret update
* [FCENGX-4146](https://netreveal.atlassian.net/browse/FCENGX-4146) - MultiBatch Org-specific endofday files are not created in the standalonehome/data directory
* [FCENGX-3967](https://netreveal.atlassian.net/browse/FCENGX-3967) - Reduce the logs that are fed to DataDog to what is useful
* [FCENGX-4124](https://netreveal.atlassian.net/browse/FCENGX-4124) - AML Application Conf does not contain multiOrg logic
* [FCENGX-3962](https://netreveal.atlassian.net/browse/FCENGX-3962) - Multi-Org data exchange via DXV does not allow new user to be created
* [FCENGX-3787](https://netreveal.atlassian.net/browse/FCENGX-3787) - Upgrade DXV to the latest image and integrate with NetReveal to map the new parameters
* [FCENGX-3907](https://netreveal.atlassian.net/browse/FCENGX-3907) - Implement multi-org support for DB extracts
* [FCENGX-3946](https://netreveal.atlassian.net/browse/FCENGX-3946) - Include Fixes from the Product for [WLMX-2925](https://netreveal.atlassian.net/browse/WLMX-2925), [APPSDEVX-1948](https://netreveal.atlassian.net/browse/APPSDEVX-1948)
* [FCENGX-3956](https://netreveal.atlassian.net/browse/FCENGX-3956) - PostgreSQL app user password is visible in the yaml definition.
* [FCENGX-4045](https://netreveal.atlassian.net/browse/FCENGX-4045) - MultiOrg Batch acquisition does not populate the default endofday.txt and currentday.txt
* [FCENGX-3957](https://netreveal.atlassian.net/browse/FCENGX-3957) - Increase dbInit maximumPoolSize
* [FCENGX-3939](https://netreveal.atlassian.net/browse/FCENGX-3939) - Implement webhook retries if nrodsftp down and comes up later
* [FCENGX-3719](https://netreveal.atlassian.net/browse/FCENGX-3719) - docker-k8s-nri-tools - Dockerfile doesn't have the option to upgrade system packages
* [FCENGX-3938](https://netreveal.atlassian.net/browse/FCENGX-3938) - WLM processing node file wlm_pn.id overwritten on pod restart
* [FCENGX-3933](https://netreveal.atlassian.net/browse/FCENGX-3933) - WLM-PN pods don't start up properly after a restart when worldcheck is loaded
* [FCENGX-3143](https://netreveal.atlassian.net/browse/FCENGX-3143) - OBDETARTE pod needs at least 3 cores allocated to the executor to work
* [FCENGX-3727](https://netreveal.atlassian.net/browse/FCENGX-3727) - Refresh Secret with license insert/update scripts before the **initialisation** job is run.

## 1.0.10

**UPGRADE PATH**

> * Due to [NGDEX-758](https://netreveal.atlassian.net/browse/NGDEX-758), the **V_SM_IETALERTS** view definition needs to be updated. An example configuration can be found here: https://netreveal-bitbucket.valiantys.net/projects/NEST/repos/k8s-nrod-override/browse/database/standalone/nr-1.0.9-to-1.0.10 .

> * FCENGX-3810 by default disables the import of the OOTB QA users. This is not having impact on any previous installations (upgrade path) because users are imported only in the fresh deployment. For fresh installations _global.nrSolutionsSwitches.qaUsers.enabled_ parameter can be defined as _true_ to import these users.

* [FCENGX-3915](https://netreveal.atlassian.net/browse/FCENGX-3915) - SparkApplication might get the PENDING_RERUN after Spark Operator has been upgraded to version 2.0.2.
* [FCENGX-3805](https://netreveal.atlassian.net/browse/FCENGX-3805) - Aquisition files passed via minio  after successfull ingestion are not creating feedback files
* [FCENGX-3810](https://netreveal.atlassian.net/browse/FCENGX-3810) - Option to disable import of the QA users.
* [FCENGX-3640](https://netreveal.atlassian.net/browse/FCENGX-3640) - Upgrade RTDE, SMBD to the latest fix pack version

## 1.0.9

* [FCENGX-3737](https://netreveal.atlassian.net/browse/FCENGX-3737) - Multiple IDPs Configuration support for K8s deployments
* [FCENGX-3590](https://netreveal.atlassian.net/browse/FCENGX-3590) - handling of batch data acquisition with multi-org folders structure

**FCENX-3590 Install note**

> for orgUnits user passwords, new variable is used. Check README.md

## 1.0.8

In the **FCENGX-3734** platform version has been upgraded from 9.4.0.1 to 9.4.0.4. The automatic platform upgrade is not done so this had to be by use of the overlay configuration. More details can be found on this Confluence Page: [Platform upgrade from version 9.4.0.1 to 9.4.0.4](https://netreveal.atlassian.net/wiki/spaces/NEST/pages/430473458/Platform+upgrade+from+version+9.4.0.1+to+9.4.0.4).

* [FCENGX-3789](https://netreveal.atlassian.net/browse/FCENGX-3789) - Issue with length of k8s pods/jobs - nr-metro-preprod - wlm pn rt
* [FCENGX-3734](https://netreveal.atlassian.net/browse/FCENGX-3734) - Upgrade the NR Platform to version 9.4.0.4 for NR K8s deployments (excluding automated upgrades for the database and configuration)
* [FCENGX-3711](https://netreveal.atlassian.net/browse/FCENGX-3711) - s3fs-daemonset.yaml - the MINIO password is visible in the yaml and in the command output

## 1.0.7

### Upgrade path from previous version

Because of changes made for [FCENGX-3289](https://netreveal.atlassian.net/browse/FCENGX-3289) the volumeClaimTemplates definition present in the StatefulSets had to be updated. And because of this modification all affected StatefulSets have to be deleted before the upgrade process is run. It can be used such script for this purpose:

```bash
export CONTEXT=<context>
export NAMESPACE=<namespace>
kubectl delete sts --context ${CONTEXT} -n ${NAMESPACE} $(kubectl get sts --context ${CONTEXT} -n ${NAMESPACE}  -o json | jq -r ' .items[] | select(.spec | has("volumeClaimTemplates")) | .metadata.name')
```

The fresh installation has to be run in case the NFS Volumes have to use NetApp.

* [FCENGX-3524](https://netreveal.atlassian.net/browse/FCENGX-3524) - Implement Custom Code Overlay for wlm-pn-sa-sim
* [FCENGX-3672](https://netreveal.atlassian.net/browse/FCENGX-3672) - The order of imports and execution of database scripts
* [FCENGX-3289](https://netreveal.atlassian.net/browse/FCENGX-3289) - Use Azure NetApp Files instead of azurefile-csi-nfs in uk-perf

> ***nr-infra-common** has to be updated as

```yaml
cloudnative-pg:
  config:
    data:
      INHERITED_ANNOTATIONS: "prometheus.io/*, velero.io/*"
```

**IMPORTANT**

To run deployment with use of the NetApp volumes **params-nr-nrod-netapp.yaml** property file has to be used.

* [FCENGX-3522](https://netreveal.atlassian.net/browse/FCENGX-3522) - Implement Custom Code Overlay for wlm-pn-rt
* [FCENGX-3521](https://netreveal.atlassian.net/browse/FCENGX-3521) - Implement Custom Code Overlay for wlm-igs
* [FCENGX-3644](https://netreveal.atlassian.net/browse/FCENGX-3644) - Use common resources with all dependencies required by IH, NR and S4S
* [FCENGX-3520](https://netreveal.atlassian.net/browse/FCENGX-3520) - Implement Custom Code Overlay for Standalone
* [FCENGX-3519](https://netreveal.atlassian.net/browse/FCENGX-3519) - Implement Custom Code Overlay for NR UI
* [FCENGX-3517](https://netreveal.atlassian.net/browse/FCENGX-3517) - Use an Unpackaged Ear File for NR UI and wlm-pn-rt
* [FCENGX-3508](https://netreveal.atlassian.net/browse/FCENGX-3508) - SMBD application can delete and create some of the directories
* [FCENGX-3580](https://netreveal.atlassian.net/browse/FCENGX-3580) - To add extraParameters for environment.conf for RTDE components
* [FCENGX-3579](https://netreveal.atlassian.net/browse/FCENGX-3579) - To parametrise smart.multiValueSeparator for obdetarte and odddetarte
* [FCENGX-3574](https://netreveal.atlassian.net/browse/FCENGX-3574) - The licence Insert script is defined as ConfigMap but should be defined as Secret
* [FCENGX-3573](https://netreveal.atlassian.net/browse/FCENGX-3573) - The RTDE/SMBD deployment fails when Network Policies are on (init containers are not created).
* [FCENGX-3606](https://netreveal.atlassian.net/browse/FCENGX-3606) - helm upgrade install of [nr-entain-dev] on [au-platypus] failed
* [FCENGX-3534](https://netreveal.atlassian.net/browse/FCENGX-3534) - s3fs-daemonset.yaml is using the MINIO password directly from property '{{ .Values.global.minio.password }}' but is should use System Variable defined base on the Secret
* [FCENGX-3547](https://netreveal.atlassian.net/browse/FCENGX-3547) - Change logging level for Kafka
* [FCENGX-2710](https://netreveal.atlassian.net/browse/FCENGX-2710) - Create a helm template for the DBExtract Cron Jobs
* [FCENGX-3489](https://netreveal.atlassian.net/browse/FCENGX-3489) - AAP Deployment and Init jobs are not defined with readOnlyRootFilesystem=true flag and deployment fails when it is set up.

## 1.0.6

* [FCENGX-3270](https://netreveal.atlassian.net/browse/FCENGX-3270) - FailOnBadRecords value is set to 1 in containerised 9.4 deployments, but is set to 0 in the OOTB 9.4 release
* [FCENGX-3319](https://netreveal.atlassian.net/browse/FCENGX-3319) - Add adminer to NR helm chart
* [FCENGX-2924](https://netreveal.atlassian.net/browse/FCENGX-2924) - Import data to schema cronJob
* [FCENGX-3467](https://netreveal.atlassian.net/browse/FCENGX-3467) - NR charts need to have the customer IP allow list annotation (ingress)

## 1.0.5

**KNOWN UPGRADE ISSUES**

Migration schema (**apps_import**) is not created autmatically with the upgrade. Workaround is described in [FCENGX-2920](https://netreveal.atlassian.net/browse/FCENGX-2920?focusedCommentId=3658670).

* [FCENGX-3373](https://netreveal.atlassian.net/browse/FCENGX-3373) - ProcessInboundEmails parameter missing from helm chart for standalone
* [FCENGX-2923](https://netreveal.atlassian.net/browse/FCENGX-2923) - Update the build (PostgreSQL schema import on NRODv2)

    **Upgrade note**

    The 'dataSourceImport' Dynamic Datasource is not created automatically during the upgrade process. It has to be created manually or imported in the ovellay configuration:

    ```xml
    <dynamic-datasources>
        <dynamic-datasource>
            <beanname><![CDATA[dataSourceImport]]></beanname>
            <displayname><![CDATA[dataSourceImport]]></displayname>
            <jndiname><![CDATA[jdbc/ImportApplicationBaseDS]]></jndiname>
            <dbtype><![CDATA[PostgreSQL]]></dbtype>
        </dynamic-datasource>
    </dynamic-datasources>
    ```

* [FCENGX-3215](https://netreveal.atlassian.net/browse/FCENGX-3215) - TLS is not supported for Outbound emails in 9.4, and box.symphonyfs.net mail server only supports SMTPS (SSL or TLS)
* [FCENGX-2921](https://netreveal.atlassian.net/browse/FCENGX-2921) - Update Wildfly configuration (PostgreSQL schema import on NRODv2)
* [FCENGX-3230](https://netreveal.atlassian.net/browse/FCENGX-3230) - Add network policy that allow traffic from Ingress Nginx towards application pods
* [FCENGX-3512](https://netreveal.atlassian.net/browse/FCENGX-3512) - WLM PN RT pod does not start
* [FCENGX-3252](https://netreveal.atlassian.net/browse/FCENGX-3252) - Kafka Entity Operator (topicOperator, userOperator) doesn't have defined limits nor memory set up
* [FCENGX-3254](https://netreveal.atlassian.net/browse/FCENGX-3254) - Zookeeper - it is not possible to update memory options
* [FCENGX-3400](https://netreveal.atlassian.net/browse/FCENGX-3400) - network policy for kafkUI missing
* [FCENGX-3369](https://netreveal.atlassian.net/browse/FCENGX-3369) - UI pod is not starting up properly after attempted UI pod restart after several days of data has been processed
* [FCENGX-2712](https://netreveal.atlassian.net/browse/FCENGX-2712) - AAP init job fails if the docker image has changed

## 1.0.4

* [FCENGX-3473](https://netreveal.atlassian.net/browse/FCENGX-3473) - ACQ: ENVLP-502: Failed to extract zip file on NRODv2
* [FCENGX-3461](https://netreveal.atlassian.net/browse/FCENGX-3461) - to import the client IDP ssl certificate there should not need ot the private key

    **Upgrade note**

    In this update the **__nr-ui.saml.samlKeycloackCertificate__** property has been renamed into **__nr-ui.saml.samlIdpCertificate__**. If old property was used in override properties then it has to be renamed.

* [FCENGX-3444](https://netreveal.atlassian.net/browse/FCENGX-3444) - To update SMBD processing-config to 9.4 for 9.4 (the AML and AMLOPT SMBD configuration was not updated to version 9.4)
* [FCENGX-3376](https://netreveal.atlassian.net/browse/FCENGX-3376) - WLM Realtime errors when sending messages to REST endpojnt nr-wlm-rt-dev using 3 replicas
* [FCENGX-3397](https://netreveal.atlassian.net/browse/FCENGX-3397) - Housekeeping for wlm archives
* [FCENGX-3229](https://netreveal.atlassian.net/browse/FCENGX-3229) - Implement an Internal Trust for network policies
* [FCENGX-3368](https://netreveal.atlassian.net/browse/FCENGX-3390) - Prometheus retention period parameters
* [FCENGX-3368](https://netreveal.atlassian.net/browse/FCENGX-2920) - Added nr migration schema

    **Upgrade note**

    In this update new properties were added to populate new DB user password:

    ```bash
    --set "global.baseConfigProperties.clusterdb.nrImportUserPassword=$POSTGRES_IMPORT_USER_PASSWORD"
    ```

    In case this property is empty then the DB apps used password is used also for this new user.


## 1.0.3

* [FCENGX-3368](https://netreveal.atlassian.net/browse/FCENGX-3368) - ImportExport job is missing the additional JVM args required as part of the Java17 upgrade
* [FCENGX-3351](https://netreveal.atlassian.net/browse/FCENGX-3351) - Added error codes for envelope script
* Upgrade version of the SensaAI Sanctions to 9.4.0.5
* Added script to update Docker Image versions in property files (updateImages.sh)
* [FCENGX-3285](https://netreveal.atlassian.net/browse/FCENGX-3285) - Wildfly - replace periodic-rotating-file-handler with size-rotating-file-handler.
* [FCENGX-3195](https://netreveal.atlassian.net/browse/FCENGX-3195) - URLs used for NR deployments to be parameterised. **Note: This will update Ingress Host Names**
* [FCENGX-2880](https://netreveal.atlassian.net/browse/FCENGX-2880) - Add SSL setup to ingress manifest for NR and NR WLM sites (as part of [FCENGX-3195])
* Added cloudnative-pg INHERITED_ANNOTATIONS

## 1.0.2

* [FCENGX-2626](https://netreveal.atlassian.net/browse/FCENGX-2626) - Update Helm configuration - Log4j
* [FCENGX-3246](https://netreveal.atlassian.net/browse/FCENGX-3246) - override job not runnig the import of NR configuration file.
* [RTOPX-462](https://netreveal.atlassian.net/browse/RTOPX-462) - PS k8s overlay enhancement
* [FCENGX-3244](https://netreveal.atlassian.net/browse/FCENGX-3244) - Option to not deploy Prometheus and Grafana
