To install nrodsftp into an environment:

Step 1:

A configmap must be applied to the ingress-nginx controller, and then
the ingress-nginx-controller config must be updated.  The following configmap example assumes that this is deployed in the nrodsftp namespace.  The data line should be in the format:
  "externalport": namespace/sftpservice:sftpport

Note that this will overwrite any existing configmap with the same name.
If you need to have multiple ports in the same configmap, add them in the
data section as appropriate:
```
cat << EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: tcp-services
  namespace: ingress-nginx
data:
  "8022": nrodsftp/minio:8022
---
EOF
```
Step 2:

Once the configmap has been created, it needs to be added to the
ingress-nginx-controller config, in the args section:

 args:
    - /nginx-ingress-controller
    - --tcp-services-configmap=ingress-nginx/tcp-services

You can do that using the kubectl patch command.  Note that depending on how ingress-nginx was deployed, this might be a daemonset or a deployment, so make sure to use the appropriate type in the patch command.
```
kubectl -n ingress-nginx patch deployment ingress-nginx-controller --type='json' \
  -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--tcp-services-configmap=ingress-nginx/tcp-services"}]'
```
This should restart the ingress-nginx-controller and make the new configmap active.

Step 3:

You now need to update the service so that the loadbalancer uses the updated ports.

kubectl -n ingress-nginx patch service ingress-nginx-controller -p '{"spec":{"ports": [{"appProtocol": "TCP","name": "ssh","nodePort": 30822,"port": 8022,"protocol": "TCP","targetPort": 8022}]}}'

Now once you install the nrodsftp helm charts, you should be able to access SFTP via the loadbalancer on port 8022.


Step 4:

Setup the values required for the minio password and the ingresses.  You can do this by creating a values.yaml file with the follow entries:

global:
  PASSWORD: ""
  MINIO_INGRESS_HOST: ""
  MINIOUI_INGRESS_HOST: ""

The password used must be alph-numeric and at least 12 characters.

Once done, you can install by running the following command:

helm upgrade --install --create-namespace -n nrodsftp nrodsftp charts/nrodsftp -f values.yaml

Also make sure to add the "regcred" and https-certs secrets into the appropriate namespace so you can pull the nrodsftp container and the appropriate certificates and ssh keys get used by the ingress and minio:

kubectl -n nrodsftp create secret docker-registry regcred --docker-server=index.docker.io --docker-username=$DH_USER --docker-password=$DH_PASS
kubectl -n nrodsftp create secret tls https-certs --key=/opt/sensa/certs/privkey.key --cert=/opt/sensa/certs/fullchain.crt
kubectl -n nrodsftp create secret generic nrodsftp-ssh-key --from-file=id_rsa=/home/ubuntu/.ssh/id_rsa --from-file=id_rsa.pub=/home/ubuntu/.ssh/id_rsa.pub