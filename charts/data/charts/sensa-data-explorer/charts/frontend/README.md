# data-explorer-frontend

Deploys the Data Explorer micro-frontend. One image, one Deployment, one
Service — serving **two artifacts** built from the same source tree:

| Path | Artifact | Who uses it |
| --- | --- | --- |
| `/data-explorer/` | Standalone SPA (`dist/`, absolute base) | Direct visitors |
| `/remotes/data-explorer/` | Module Federation remote (`dist-remote/`, relative base) | A host portal that mounts the app |

Serving both from one pod is deliberate: the standalone app and the embedded
one can never drift to different versions.

## The remote URL

This is what a parent application needs. The chart creates a ClusterIP
Service named after the chart, so the in-cluster URL is:

```
http://data-explorer-frontend.<namespace>.svc.cluster.local
```

The remote entry itself then lives at:

```
http://data-explorer-frontend.<namespace>.svc.cluster.local/remotes/data-explorer/remoteEntry.js
```

**The parent does not point a browser at that URL.** It is a server-side
address — the host proxies it to its own origin so the remote loads
same-origin, with no CORS and behind the host's own auth gate. In the SRI
portal that means two env vars:

| Portal env var | Value |
| --- | --- |
| `DATA_EXPLORER_URL` | `http://data-explorer-frontend.<namespace>.svc.cluster.local` |
| `DATA_EXPLORER_API_URL` | The data-api Service, e.g. `http://listops-data-api.<namespace>.svc.cluster.local:8000` |

The portal proxies `/remotes/data-explorer/*` to the first and
`/api/data-explorer/*` to the second. If the portal runs in a different
namespace, keep the fully-qualified `.svc.cluster.local` form — a server-side
fetch crosses namespaces, an Ingress backend does not.

## Install

```bash
helm upgrade --install data-explorer-frontend deploy/helm/frontend \
  --namespace <ns> \
  --set image.tag=<tag>
```

Values worth setting: `image.tag`, `replicaCount`, `resources`, and
`podAnnotations` (the CD pipeline should stamp the commit SHA there — a
rebuilt mutable tag like `main` is not a pod-spec change, so Helm would
otherwise never roll the pod on a same-branch redeploy).

## Smoke check

The readiness probe hits `/health`, which is a static nginx 200 — it proves
the server is up, not that the remote artifact survived the build. Check that
separately:

```bash
kubectl port-forward svc/data-explorer-frontend -n <ns> 8080:80
curl -sI localhost:8080/remotes/data-explorer/remoteEntry.js   # 200, JS content-type
```

A 404 there means the image was built without `npm run build:remote`, or the
Dockerfile did not copy `dist-remote/`. An HTML body means an SPA fallback is
catching the path — the `^~ /remotes/data-explorer/` location exists to
prevent exactly that.

## There is no ingress

Same as the data-api chart: reaching this directly means `kubectl
port-forward`. Embedded use does not need one — the portal reaches the
Service in-cluster.

## Identity

The data-api expects `aud: data-explorer` (`settings.keycloak.audience` in
the data-api chart). A host portal minting its own tokens must add that
audience to the client it mints from, or every embedded call 401s despite a
valid session.
