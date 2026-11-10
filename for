[0;34m[rebuild][0m Repo has uncommitted or untracked changes; using deterministic dirty build version 335a345-dirty-a12b708b2d2f
[0;34m[rebuild][0m Detected Docker Desktop credential helper configuration in /home/juberm/.docker/config.json
[0;34m[rebuild][0m This commonly breaks Docker BuildKit in WSL with: error listing credentials - err: exit status 1
[0;34m[rebuild][0m Using a temporary isolated Docker config for this rebuild to avoid the broken credsStore
[0;34m[rebuild][0m Using isolated Docker config at /tmp/cloudhub-docker-config.EP2hpb (removed credential helper entries that break WSL builds)
[0;34m[rebuild][0m Using the active Docker context: default

[1m[0;34m════════════════════════════════════════[0m
[1mPre-flight Checks[0m
[1m[0;34m════════════════════════════════════════[0m
[0;32m[✓][0m All required base images are present locally

[1m[0;34m════════════════════════════════════════[0m
[1mStarting Full Clean Rebuild[0m
[1m[0;34m════════════════════════════════════════[0m
[0;34m[rebuild][0m Mode: Full teardown + cached rebuild + force recreate
 Container platform_cloudhub-frontend-1 Stopping 
 Container platform_cloudhub-frontend-1 Stopped 
 Container platform_cloudhub-frontend-1 Removing 
 Container platform_cloudhub-frontend-1 Removed 
 Container platform_cloudhub-backend-1 Stopping 
 Container platform_cloudhub-backend-1 Stopped 
 Container platform_cloudhub-backend-1 Removing 
 Container platform_cloudhub-backend-1 Removed 
 Container platform_cloudhub-postgres-1 Stopping 
 Container platform_cloudhub-postgres-1 Stopped 
 Container platform_cloudhub-postgres-1 Removing 
 Container platform_cloudhub-postgres-1 Removed 
 Network platform_cloudhub_default Removing 
 Network platform_cloudhub_default Removed 
[0;34m[rebuild][0m Ensuring required local ports are free: 3000 7007 5433
[0;34m[rebuild][0m Timer 'full_stop' elapsed: 11s
[0;34m[rebuild][0m Local developer rebuild: injecting localhost-only URLs for frontend/backend
[0;34m[rebuild][0m This is intentional and only for the local source rebuild flow; production builds must use public HTTPS URLs
[0;34m[rebuild][0m Using Docker cache where applicable

[1m[0;34m════════════════════════════════════════[0m
[1mHost Build (Backend Artifacts)[0m
[1m[0;34m════════════════════════════════════════[0m
[0;34m[rebuild][0m Building backend artifacts on the host before Docker image build
[0;34m[rebuild][0m This avoids ~8min of native module compilation inside Docker on WSL2
[0;34m[rebuild][0m Running: yarn install --immutable
➤ YN0000: · Yarn 4.4.1
➤ YN0000: ┌ Resolution step
➤ YN0000: └ Completed in 1s 957ms
➤ YN0000: ┌ Post-resolution validation
➤ YN0060: │ @types/react is listed by your project with version 18.3.29 (p39d2f), which doesn't satisfy what @material-ui/core (via @backstage/core-components) and other dependencies request (but they have non-overlapping ranges!).
➤ YN0060: │ jest is listed by your project with version 27.5.1 (p1cd07), which doesn't satisfy what @backstage/cli and other dependencies request (^29.0.0 || ^30.0.0).
➤ YN0060: │ react is listed by your project with version 18.3.1 (p953f2), which doesn't satisfy what @material-ui/core (via @backstage/core-components) and other dependencies request (but they have non-overlapping ranges!).
➤ YN0060: │ react is listed by your project with version 18.3.1 (pd98da), which doesn't satisfy what @material-ui/core (via @backstage-community/plugin-github-actions) and other dependencies request (but they have non-overlapping ranges!).
➤ YN0060: │ react-dom is listed by your project with version 18.3.1 (p5dab4), which doesn't satisfy what @material-ui/core (via @backstage/core-components) and other dependencies request (but they have non-overlapping ranges!).
➤ YN0060: │ react-dom is listed by your project with version 18.3.1 (pfa800), which doesn't satisfy what @material-ui/core (via @backstage-community/plugin-github-actions) and other dependencies request (but they have non-overlapping ranges!).
➤ YN0002: │ @internal/plugin-cluster-registry@workspace:plugins/cluster-registry [f87a9] doesn't provide jest (p7329e), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-cluster-registry@workspace:plugins/cluster-registry [f87a9] doesn't provide react-dom (p576b1), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-cluster-registry@workspace:plugins/cluster-registry doesn't provide @types/react (pbbce2), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-cluster-registry@workspace:plugins/cluster-registry doesn't provide jest (pe3712), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-cluster-registry@workspace:plugins/cluster-registry doesn't provide react (pdf8ef), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-cluster-registry@workspace:plugins/cluster-registry doesn't provide react-dom (p1b4c4), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-cluster-registry@workspace:plugins/cluster-registry doesn't provide react-router-dom (pcff09), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-deployment-control-plane-backend@workspace:plugins/deployment-control-plane-backend doesn't provide @types/react (pb77e8), requested by @internal/plugin-platform-common and other dependencies.
➤ YN0002: │ @internal/plugin-deployment-control-plane-backend@workspace:plugins/deployment-control-plane-backend doesn't provide jest (pfef68), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-deployment-control-plane-backend@workspace:plugins/deployment-control-plane-backend doesn't provide react (p2511c), requested by @internal/plugin-platform-common and other dependencies.
➤ YN0002: │ @internal/plugin-deployment-control-plane-backend@workspace:plugins/deployment-control-plane-backend doesn't provide react-dom (pc6f33), requested by @mui/material.
➤ YN0002: │ @internal/plugin-infrastructure-provisioning@workspace:plugins/infrastructure-provisioning [f87a9] doesn't provide jest (p3af86), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-infrastructure-provisioning@workspace:plugins/infrastructure-provisioning [f87a9] doesn't provide react-dom (pd3c07), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-infrastructure-provisioning@workspace:plugins/infrastructure-provisioning [f87a9] doesn't provide react-router-dom (pef317), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-infrastructure-provisioning@workspace:plugins/infrastructure-provisioning doesn't provide @types/react (p50214), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-infrastructure-provisioning@workspace:plugins/infrastructure-provisioning doesn't provide jest (p2ecf4), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-infrastructure-provisioning@workspace:plugins/infrastructure-provisioning doesn't provide react (p3da28), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-infrastructure-provisioning@workspace:plugins/infrastructure-provisioning doesn't provide react-dom (pc47f3), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-infrastructure-provisioning@workspace:plugins/infrastructure-provisioning doesn't provide react-router-dom (p56203), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common [82470] doesn't provide jest (pced46), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common [82470] doesn't provide react-dom (pe601e), requested by @backstage/core-plugin-api.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common [82470] doesn't provide react-router-dom (p0a5fd), requested by @backstage/core-plugin-api.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common [f87a9] doesn't provide jest (p6e4b5), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common [f87a9] doesn't provide react-dom (pb44d4), requested by @backstage/core-plugin-api.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common [f87a9] doesn't provide react-router-dom (pf9114), requested by @backstage/core-plugin-api.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common doesn't provide @types/react (p39c0a), requested by @backstage/core-plugin-api and other dependencies.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common doesn't provide jest (p69e98), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common doesn't provide react (pe731c), requested by @backstage/core-plugin-api and other dependencies.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common doesn't provide react-dom (p02f75), requested by @backstage/core-plugin-api and other dependencies.
➤ YN0002: │ @internal/plugin-platform-common@workspace:plugins/platform-common doesn't provide react-router-dom (pdfe8d), requested by @backstage/core-plugin-api.
➤ YN0002: │ @internal/plugin-platform-deployment@workspace:plugins/platform-deployment [f87a9] doesn't provide jest (pb2455), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-deployment@workspace:plugins/platform-deployment [f87a9] doesn't provide react-dom (pbd02a), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-deployment@workspace:plugins/platform-deployment [f87a9] doesn't provide react-router-dom (p101a2), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-deployment@workspace:plugins/platform-deployment doesn't provide @types/react (pc4c4a), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-deployment@workspace:plugins/platform-deployment doesn't provide jest (p2a348), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-deployment@workspace:plugins/platform-deployment doesn't provide react (p534a7), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-deployment@workspace:plugins/platform-deployment doesn't provide react-dom (p1969e), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-deployment@workspace:plugins/platform-deployment doesn't provide react-router-dom (p24c49), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home [f87a9] doesn't provide @material-ui/core (paeda2), requested by @backstage/theme.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home [f87a9] doesn't provide @testing-library/dom (p1ae01), requested by @testing-library/react and other dependencies.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home [f87a9] doesn't provide jest (p86ef4), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home [f87a9] doesn't provide react-dom (p09e58), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home doesn't provide @material-ui/core (p665a2), requested by @backstage/theme.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home doesn't provide @testing-library/dom (pf4ee2), requested by @testing-library/react and other dependencies.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home doesn't provide @types/react (p26447), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home doesn't provide jest (pf455d), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home doesn't provide react (p07115), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home doesn't provide react-dom (pdb5d3), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-home@workspace:plugins/platform-home doesn't provide react-router-dom (pa90bd), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-registry-backend@workspace:plugins/platform-registry-backend doesn't provide @types/react (p7e27a), requested by @mui/icons-material and other dependencies.
➤ YN0002: │ @internal/plugin-platform-registry-backend@workspace:plugins/platform-registry-backend doesn't provide jest (p9306a), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-registry-backend@workspace:plugins/platform-registry-backend doesn't provide react (p5c593), requested by @mui/icons-material and other dependencies.
➤ YN0002: │ @internal/plugin-platform-registry-backend@workspace:plugins/platform-registry-backend doesn't provide react-dom (p075ef), requested by @mui/material.
➤ YN0002: │ @internal/plugin-platform-registry@workspace:plugins/platform-registry [f87a9] doesn't provide jest (pd2aab), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-registry@workspace:plugins/platform-registry [f87a9] doesn't provide react-dom (pc0032), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-registry@workspace:plugins/platform-registry doesn't provide @types/react (pf19c8), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-registry@workspace:plugins/platform-registry doesn't provide jest (p05221), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-platform-registry@workspace:plugins/platform-registry doesn't provide react (p3f5c4), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-registry@workspace:plugins/platform-registry doesn't provide react-dom (p6e3e2), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-platform-registry@workspace:plugins/platform-registry doesn't provide react-router-dom (p6589f), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-overlay-manager@workspace:plugins/tenant-overlay-manager [f87a9] doesn't provide jest (p01793), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-tenant-overlay-manager@workspace:plugins/tenant-overlay-manager [f87a9] doesn't provide react-dom (p62b3b), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-overlay-manager@workspace:plugins/tenant-overlay-manager [f87a9] doesn't provide react-router-dom (p1bf91), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-overlay-manager@workspace:plugins/tenant-overlay-manager doesn't provide @types/react (pee73f), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-overlay-manager@workspace:plugins/tenant-overlay-manager doesn't provide jest (p7b677), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-tenant-overlay-manager@workspace:plugins/tenant-overlay-manager doesn't provide react (pf44c0), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-overlay-manager@workspace:plugins/tenant-overlay-manager doesn't provide react-dom (pfb470), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-overlay-manager@workspace:plugins/tenant-overlay-manager doesn't provide react-router-dom (pabbf4), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-registry-backend@workspace:plugins/tenant-registry-backend doesn't provide @types/react (pd02e2), requested by @mui/icons-material and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-registry-backend@workspace:plugins/tenant-registry-backend doesn't provide jest (p7b472), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-tenant-registry-backend@workspace:plugins/tenant-registry-backend doesn't provide react (p71774), requested by @mui/icons-material and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-registry-backend@workspace:plugins/tenant-registry-backend doesn't provide react-dom (p37727), requested by @mui/material.
➤ YN0002: │ @internal/plugin-tenant-registry@workspace:plugins/tenant-registry [f87a9] doesn't provide jest (p914b9), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-tenant-registry@workspace:plugins/tenant-registry [f87a9] doesn't provide react-dom (p1eb29), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-registry@workspace:plugins/tenant-registry doesn't provide @types/react (p7fb7e), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-registry@workspace:plugins/tenant-registry doesn't provide jest (pe1833), requested by @backstage/cli.
➤ YN0002: │ @internal/plugin-tenant-registry@workspace:plugins/tenant-registry doesn't provide react (p5f4ec), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-registry@workspace:plugins/tenant-registry doesn't provide react-dom (pb1373), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ @internal/plugin-tenant-registry@workspace:plugins/tenant-registry doesn't provide react-router-dom (p942f1), requested by @backstage/core-components and other dependencies.
➤ YN0002: │ app@workspace:packages/app doesn't provide @material-ui/core (pd25bb), requested by @backstage/theme.
➤ YN0002: │ app@workspace:packages/app doesn't provide @types/react (pceee1), requested by @backstage/core-app-api and other dependencies.
➤ YN0002: │ app@workspace:packages/app doesn't provide jest (p99cdc), requested by @backstage/cli.
➤ YN0002: │ backend@workspace:packages/backend doesn't provide @types/react (p0eaa9), requested by @mui/icons-material and other dependencies.
➤ YN0002: │ backend@workspace:packages/backend doesn't provide jest (p35ee3), requested by @backstage/cli.
➤ YN0002: │ backend@workspace:packages/backend doesn't provide react (p9301f), requested by @mui/icons-material and other dependencies.
➤ YN0002: │ backend@workspace:packages/backend doesn't provide react-dom (p1c93c), requested by @mui/material.
➤ YN0002: │ root@workspace:. doesn't provide @types/react (pac846), requested by @mui/icons-material and other dependencies.
➤ YN0002: │ root@workspace:. doesn't provide react (p44cfe), requested by @mui/icons-material and other dependencies.
➤ YN0002: │ root@workspace:. doesn't provide react-dom (pec1ab), requested by @mui/material and other dependencies.
➤ YN0086: │ Some peer dependencies are incorrectly met by your project; run yarn explain peer-requirements <hash> for details, where <hash> is the six-letter p-prefixed code.
➤ YN0086: │ Some peer dependencies are incorrectly met by dependencies; run yarn explain peer-requirements for details.
➤ YN0000: └ Completed in 0s 433ms
➤ YN0000: ┌ Fetch step
➤ YN0000: └ Completed in 17s 996ms
➤ YN0000: ┌ Link step
➤ YN0000: └ Completed in 3s 15ms
➤ YN0000: · Done with warnings in 24s 510ms
[0;34m[rebuild][0m Running: yarn build:backend
Building app separately because it is a bundled package
app: Loaded config from app-config.yaml, app-config.local.yaml
app:   500.12 kB          [2mdist/static/[22m[36m5981.5384055b.chunk.js[39m
app:   348.85 kB          [2mdist/static/[22m[36mmodule-backstage.7f8c630e.js[39m
app:   290.8 kB           [2mdist/static/[22m[36mvendor.29298ed9.js[39m
app:   272.75 kB          [2mdist/static/[22m[36m1620.1620.809898e6.css[39m
app:   210.47 kB          [2mdist/static/[22m[36mmodule-swagger-ui-react.42aac1d1.js[39m
app:   201.36 kB          [2mdist/static/[22m[36m9402.2908cd22.chunk.js[39m
app:   195.63 kB          [2mdist/static/[22m[36m1620.ec6b52e6.chunk.js[39m
app:   154.88 kB ([32m-17 B[39m)  [2mdist/static/[22m[36mmain.c6b1b924.js[39m
app:   153.58 kB          [2mdist/static/[22m[36m1940.bf36b009.chunk.js[39m
app:   118.8 kB           [2mdist/static/[22m[36m9543.7c0c3ce9.chunk.js[39m
app:   111.73 kB          [2mdist/static/[22m[36mmodule-backstage-community.68894a06.js[39m
app:   110.23 kB          [2mdist/static/[22m[36mmodule-material-ui.9964cff6.js[39m
app:   105.24 kB          [2mdist/static/[22m[36mmodule-mui.5a13a845.js[39m
app:   80.54 kB           [2mdist/static/[22m[36mmodule-zod.56e6bea2.js[39m
app:   72.82 kB           [2mdist/static/[22m[36mmodule-react-aria.81ad9ac7.js[39m
app:   67.54 kB           [2mdist/static/[22m[36mmodule-xterm.9884858c.js[39m
app:   57.36 kB           [2mdist/static/[22m[36m1489.d27bcd96.chunk.js[39m
app:   48.27 kB           [2mdist/static/[22m[36m8849.eaa8a16e.chunk.js[39m
app:   46.14 kB           [2mdist/static/[22m[36mmodule-parse5.b1755bf0.js[39m
app:   44.29 kB           [2mdist/static/[22m[36mmodule-lodash.46472305.js[39m
app:   41.2 kB            [2mdist/static/[22m[36mmodule-react-dom.e30dc02c.js[39m
app:   40.38 kB           [2mdist/static/[22m[36mvendor.e4c441a3.css[39m
app:   32.66 kB           [2mdist/static/[22m[36mmodule-motion-dom.a03d741e.js[39m
app:   32.63 kB           [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_mathematica.91a63a4e.chunk.js[39m
app:   31.44 kB           [2mdist/static/[22m[36mmodule-material-table.6315b71e.js[39m
app:   31.22 kB           [2mdist/static/[22m[36mmodule-yaml.04338533.js[39m
app:   29.05 kB           [2mdist/static/[22m[36mmodule-ajv.46116801.js[39m
app:   28.84 kB           [2mdist/static/[22m[36mmodule-react-beautiful-dnd.ff20f67b.js[39m
app:   27.86 kB           [2mdist/static/[22m[36m3214.20e3c2b0.chunk.js[39m
app:   26.22 kB           [2mdist/static/[22m[36m9402.9402.01356e77.css[39m
app:   23.68 kB           [2mdist/static/[22m[36m8839.fbf2b42c.chunk.js[39m
app:   21.83 kB           [2mdist/static/[22m[36mmodule-luxon.bd91cc04.js[39m
app:   21.78 kB           [2mdist/static/[22m[36m4849.0822d015.chunk.js[39m
app:   20.19 kB           [2mdist/static/[22m[36mmodule-photoswipe.ad2f0fa9.js[39m
app:   19.3 kB            [2mdist/static/[22m[36mmodule-autolinker.d13e7a3f.js[39m
app:   19.29 kB           [2mdist/static/[22m[36m5022.e2da6d28.chunk.js[39m
app:   18.77 kB           [2mdist/static/[22m[36mmodule-react-stately.10efcea7.js[39m
app:   18.34 kB           [2mdist/static/[22m[36m1556.865c4f9a.chunk.js[39m
app:   18.01 kB           [2mdist/static/[22m[36m7691.ecd97b5f.chunk.js[39m
app:   17.75 kB           [2mdist/static/[22m[36mmodule-remix-run.93afd969.js[39m
app:   16.94 kB           [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_isbl.6c23f73f.chunk.js[39m
app:   16.78 kB           [2mdist/static/[22m[36m2186.2aafaaa3.chunk.js[39m
app:   14.92 kB           [2mdist/static/[22m[36m60.d42057a3.chunk.js[39m
app:   14.67 kB           [2mdist/static/[22m[36mmodule-i18next.02314eb3.js[39m
app:   14.67 kB           [2mdist/static/[22m[36m8380.aeec877f.chunk.js[39m
app:   14.22 kB           [2mdist/static/[22m[36mmodule-remarkable.5e949be6.js[39m
app:   13.72 kB           [2mdist/static/[22m[36m7799.0324622d.chunk.js[39m
app:   13.7 kB            [2mdist/static/[22m[36m1727.816f573f.chunk.js[39m
app:   13.65 kB           [2mdist/static/[22m[36mmodule-highlight.js.128580e3.js[39m
app:   13.16 kB           [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_gml.e62a93b7.chunk.js[39m
app:   13.02 kB           [2mdist/static/[22m[36m8712.f0c8ce53.chunk.js[39m
app:   12.78 kB           [2mdist/static/[22m[36mmodule-date-fns.e6ec5c7e.js[39m
app:   12.64 kB           [2mdist/static/[22m[36m1018.b6f83b0e.chunk.js[39m
app:   12.59 kB           [2mdist/static/[22m[36mmodule-js-yaml.c161f7ee.js[39m
app:   12.42 kB           [2mdist/static/[22m[36mmodule-react-aria-components.32ef3c38.js[39m
app:   11.98 kB           [2mdist/static/[22m[36m5526.4d316242.chunk.js[39m
app:   11.93 kB           [2mdist/static/[22m[36m3835.198b451c.chunk.js[39m
app:   11.6 kB            [2mdist/static/[22m[36mmodule-framer-motion.db3217ae.js[39m
app:   10.82 kB           [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_maxima.3143de7c.chunk.js[39m
app:   10.71 kB           [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_sqf.bebbaa10.chunk.js[39m
app:   10.58 kB           [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_oneC.8da3666e.chunk.js[39m
app:   10.39 kB           [2mdist/static/[22m[36mmodule-react-hook-form.4c468cc0.js[39m
app:   9.24 kB            [2mdist/static/[22m[36mmodule-typespec.ecefa3e7.js[39m
app:   8.91 kB            [2mdist/static/[22m[36m4569.32e1ad0e.chunk.js[39m
app:   8.67 kB            [2mdist/static/[22m[36m8033.9dc25d72.chunk.js[39m
app:   8.45 kB            [2mdist/static/[22m[36m866.f9508755.chunk.js[39m
app:   8.38 kB            [2mdist/static/[22m[36m9734.4101b779.chunk.js[39m
app:   7.92 kB            [2mdist/static/[22m[36mmodule-ramda.8135f449.js[39m
app:   7.86 kB            [2mdist/static/[22m[36m4602.27704bae.chunk.js[39m
app:   7.67 kB            [2mdist/static/[22m[36m1804.b7a1a02e.chunk.js[39m
app:   7.55 kB            [2mdist/static/[22m[36m9165.a3f2bdb8.chunk.js[39m
app:   7.4 kB             [2mdist/static/[22m[36m1486.f5e34502.chunk.js[39m
app:   7.19 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_pgsql.d3eaeeee.chunk.js[39m
app:   7.18 kB            [2mdist/static/[22m[36m8389.7f7da568.chunk.js[39m
app:   7.18 kB            [2mdist/static/[22m[36m1295.3c052134.chunk.js[39m
app:   7.03 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_x86asm.2024b693.chunk.js[39m
app:   7.02 kB            [2mdist/static/[22m[36m2048.bfee63d4.chunk.js[39m
app:   6.97 kB            [2mdist/static/[22m[36m4500.a9ca8551.chunk.js[39m
app:   6.97 kB            [2mdist/static/[22m[36mmodule-micromark-core-commonmark.6d530f9d.js[39m
app:   6.91 kB            [2mdist/static/[22m[36m3598.d714e71f.chunk.js[39m
app:   6.78 kB            [2mdist/static/[22m[36mruntime.3448f4ed.js[39m
app:   6.67 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_stata.29a8e9ef.chunk.js[39m
app:   6.64 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_mel.cc61bdc8.chunk.js[39m
app:   6.54 kB            [2mdist/static/[22m[36m2692.2f7738d6.chunk.js[39m
app:   6.45 kB            [2mdist/static/[22m[36m4921.5379c4ba.chunk.js[39m
app:   6.16 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_lsl.18e786d2.chunk.js[39m
app:   6.03 kB            [2mdist/static/[22m[36m9630.b51de850.chunk.js[39m
app:   5.73 kB            [2mdist/static/[22m[36m5745.e027f685.chunk.js[39m
app:   5.58 kB            [2mdist/static/[22m[36m4644.3ac88830.chunk.js[39m
app:   5.47 kB            [2mdist/static/[22m[36m92.12d37008.chunk.js[39m
app:   5.41 kB            [2mdist/static/[22m[36m4693.729b2e3c.chunk.js[39m
app:   5.37 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_gauss.44cd35a9.chunk.js[39m
app:   5.36 kB            [2mdist/static/[22m[36m8747.5d8a2c72.chunk.js[39m
app:   5.34 kB            [2mdist/static/[22m[36mmodule-remixicon.3542ad4d.js[39m
app:   5.34 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_sqlMore.142c8bb9.chunk.js[39m
app:   5.32 kB            [2mdist/static/[22m[36m1396.62ca2fa7.chunk.js[39m
app:   5.21 kB            [2mdist/static/[22m[36m1549.1a854e9d.chunk.js[39m
app:   5.17 kB            [2mdist/static/[22m[36m6268.ed0ac07a.chunk.js[39m
app:   5.01 kB            [2mdist/static/[22m[36m5981.5981.9200fc8d.css[39m
app:   4.98 kB            [2mdist/static/[22m[36m480.b6f06e5a.chunk.js[39m
app:   4.69 kB            [2mdist/static/[22m[36m5761.8c7d260e.chunk.js[39m
app:   4.63 kB            [2mdist/static/[22m[36m4609.9e6e06b7.chunk.js[39m
app:   4.55 kB            [2mdist/static/[22m[36m6959.55da6d73.chunk.js[39m
app:   4.34 kB            [2mdist/static/[22m[36m9279.210bff77.chunk.js[39m
app:   4.27 kB            [2mdist/static/[22m[36m6522.db33d15a.chunk.js[39m
app:   4.24 kB            [2mdist/static/[22m[36m4124.402bbc30.chunk.js[39m
app:   4.2 kB             [2mdist/static/[22m[36m2514.bedf5e70.chunk.js[39m
app:   4.19 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_arduino.bf68bf7f.chunk.js[39m
app:   4.19 kB            [2mdist/static/[22m[36m7780.4e674ce8.chunk.js[39m
app:   4.19 kB            [2mdist/static/[22m[36mmain.74bc9f93.css[39m
app:   4.17 kB            [2mdist/static/[22m[36m8733.5b21c8c9.chunk.js[39m
app:   4.16 kB            [2mdist/static/[22m[36m9615.392ce82a.chunk.js[39m
app:   4.16 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_vim.43612763.chunk.js[39m
app:   4.14 kB            [2mdist/static/[22m[36m8334.2b83dd75.chunk.js[39m
app:   4.13 kB            [2mdist/static/[22m[36m4633.e3a5addf.chunk.js[39m
app:   4 kB               [2mdist/static/[22m[36m6953.9e1dcff5.chunk.js[39m
app:   3.99 kB            [2mdist/static/[22m[36m2239.61051981.chunk.js[39m
app:   3.88 kB            [2mdist/static/[22m[36m4084.1c46f079.chunk.js[39m
app:   3.85 kB            [2mdist/static/[22m[36m5663.461d7436.chunk.js[39m
app:   3.83 kB            [2mdist/static/[22m[36m2770.74a723f5.chunk.js[39m
app:   3.83 kB            [2mdist/static/[22m[36m3046.abf0e4f1.chunk.js[39m
app:   3.8 kB             [2mdist/static/[22m[36m6241.6e568d74.chunk.js[39m
app:   3.72 kB            [2mdist/static/[22m[36m6837.12723a63.chunk.js[39m
app:   3.67 kB            [2mdist/static/[22m[36m4681.3576ab21.chunk.js[39m
app:   3.65 kB            [2mdist/static/[22m[36m5385.76db3a8b.chunk.js[39m
app:   3.64 kB            [2mdist/static/[22m[36m7198.71625927.chunk.js[39m
app:   3.48 kB            [2mdist/static/[22m[36m2849.14a5690f.chunk.js[39m
app:   3.48 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_livecodeserver.9ce029e8.chunk.js[39m
app:   3.23 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_swift.b4123efe.chunk.js[39m
app:   3.12 kB            [2mdist/static/[22m[36m999.686b3c86.chunk.js[39m
app:   3.09 kB            [2mdist/static/[22m[36m5980.a0913d0e.chunk.js[39m
app:   2.99 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_scss.989b3388.chunk.js[39m
app:   2.96 kB            [2mdist/static/[22m[36m6243.a3f040eb.chunk.js[39m
app:   2.95 kB            [2mdist/static/[22m[36m499.3eb23c1d.chunk.js[39m
app:   2.92 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_less.e4dd0523.chunk.js[39m
app:   2.83 kB            [2mdist/static/[22m[36m3873.697b009c.chunk.js[39m
app:   2.8 kB             [2mdist/static/[22m[36m3644.b047d495.chunk.js[39m
app:   2.75 kB            [2mdist/static/[22m[36m7455.1617bed1.chunk.js[39m
app:   2.74 kB            [2mdist/static/[22m[36m0.a8cc4c1e.chunk.js[39m
app:   2.67 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_autoit.a47e3297.chunk.js[39m
app:   2.66 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_stylus.4f643ae9.chunk.js[39m
app:   2.65 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_glsl.64f2034c.chunk.js[39m
app:   2.61 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_css.1240c27c.chunk.js[39m
app:   2.58 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_nsis.b7e1006c.chunk.js[39m
app:   2.57 kB            [2mdist/static/[22m[36m7044.c09b200f.chunk.js[39m
app:   2.54 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_typescript.7eb82779.chunk.js[39m
app:   2.52 kB            [2mdist/static/[22m[36m4532.013a740a.chunk.js[39m
app:   2.51 kB            [2mdist/static/[22m[36m276.9ce78d92.chunk.js[39m
app:   2.49 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_sql.45d4c377.chunk.js[39m
app:   2.49 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_xquery.11e53427.chunk.js[39m
app:   2.49 kB            [2mdist/static/[22m[36m923.9fee1026.chunk.js[39m
app:   2.38 kB            [2mdist/static/[22m[36m2759.8e6e76ac.chunk.js[39m
app:   2.37 kB            [2mdist/static/[22m[36m9352.6eb258d6.chunk.js[39m
app:   2.36 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_irpf90.8988e9e8.chunk.js[39m
app:   2.36 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_fortran.5b6adf65.chunk.js[39m
app:   2.36 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_cLike.efb10e89.chunk.js[39m
app:   2.35 kB            [2mdist/static/[22m[36m7714.30e2d25e.chunk.js[39m
app:   2.33 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_stan.4bdac633.chunk.js[39m
app:   2.28 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_cpp.bc9494e6.chunk.js[39m
app:   2.25 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_verilog.18fe871a.chunk.js[39m
app:   2.18 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_excel.e7d23a2f.chunk.js[39m
app:   2.12 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_c.47ca66b0.chunk.js[39m
app:   2.07 kB            [2mdist/static/[22m[36m7697.034e2dfc.chunk.js[39m
app:   2.06 kB            [2mdist/static/[22m[36m8483.5b291489.chunk.js[39m
app:   2.04 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_puppet.b8fcf946.chunk.js[39m
app:   2.02 kB            [2mdist/static/[22m[36m7578.3ca62e88.chunk.js[39m
app:   2 kB               [2mdist/static/[22m[36m8614.083556d6.chunk.js[39m
app:   1.99 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_armasm.3830bddd.chunk.js[39m
app:   1.98 kB            [2mdist/static/[22m[36m6653.0db3e942.chunk.js[39m
app:   1.97 kB            [2mdist/static/[22m[36m4957.591a6740.chunk.js[39m
app:   1.97 kB            [2mdist/static/[22m[36m455.1d74107f.chunk.js[39m
app:   1.96 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_clojure.ae51222d.chunk.js[39m
app:   1.93 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_perl.ee6e1eaf.chunk.js[39m
app:   1.92 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_php.c914eb74.chunk.js[39m
app:   1.91 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_sas.25ffa096.chunk.js[39m
app:   1.9 kB             [2mdist/static/[22m[36m9969.f5e45f2f.chunk.js[39m
app:   1.87 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_julia.3295f540.chunk.js[39m
app:   1.82 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_coq.2b2758bc.chunk.js[39m
app:   1.73 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_ruleslanguage.477139ba.chunk.js[39m
app:   1.72 kB            [2mdist/static/[22m[36m8946.d25f15ea.chunk.js[39m
app:   1.72 kB            [2mdist/static/[22m[36m3191.b0a8ee6b.chunk.js[39m
app:   1.7 kB             [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_hsp.ffed2976.chunk.js[39m
app:   1.64 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_processing.27d81b92.chunk.js[39m
app:   1.63 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_ruby.3b82d62f.chunk.js[39m
app:   1.63 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_hy.edad4f17.chunk.js[39m
app:   1.62 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_csharp.92f394e7.chunk.js[39m
app:   1.62 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_latex.85cb2018.chunk.js[39m
app:   1.61 kB            [2mdist/static/[22m[36m4703.0e70c258.chunk.js[39m
app:   1.6 kB             [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_livescript.e5f1d410.chunk.js[39m
app:   1.58 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_scheme.86f0ba01.chunk.js[39m
app:   1.56 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_r.f4bed004.chunk.js[39m
app:   1.52 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_mipsasm.feb6b428.chunk.js[39m
app:   1.51 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_vbnet.3dc180b9.chunk.js[39m
app:   1.51 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_applescript.e25c325b.chunk.js[39m
app:   1.51 kB            [2mdist/static/[22m[36m6412.53033d0d.chunk.js[39m
app:   1.5 kB             [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_n1ql.2fe8abf0.chunk.js[39m
app:   1.49 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_gams.bea53ac3.chunk.js[39m
app:   1.49 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_llvm.8253bb49.chunk.js[39m
app:   1.49 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_python.1e1b1bfa.chunk.js[39m
app:   1.48 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_objectivec.508b984a.chunk.js[39m
app:   1.48 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_lasso.e49059af.chunk.js[39m
app:   1.47 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_kotlin.729987ea.chunk.js[39m
app:   1.46 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_arcade.2aafd9a7.chunk.js[39m
app:   1.46 kB            [2mdist/static/[22m[36m1263.3cf20086.chunk.js[39m
app:   1.44 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_coffeescript.e953885c.chunk.js[39m
app:   1.44 kB            [2mdist/static/[22m[36m2859.d9239520.chunk.js[39m
app:   1.44 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_crystal.e3fb10e3.chunk.js[39m
app:   1.42 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_routeros.5bfa4ef4.chunk.js[39m
app:   1.41 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_qml.5c897fd3.chunk.js[39m
app:   1.39 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_reasonml.7fcc3822.chunk.js[39m
app:   1.38 kB            [2mdist/static/[22m[36m6187.f9d4b93e.chunk.js[39m
app:   1.34 kB            [2mdist/static/[22m[36m1068.af41df42.chunk.js[39m
app:   1.31 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_matlab.5d1e960b.chunk.js[39m
app:   1.3 kB             [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_rust.8fc56168.chunk.js[39m
app:   1.24 kB            [2mdist/static/[22m[36m7131.1589a855.chunk.js[39m
app:   1.23 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_d.dffd5777.chunk.js[39m
app:   1.21 kB            [2mdist/static/[22m[36m2660.5ab13b99.chunk.js[39m
app:   1.21 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_avrasm.9956b773.chunk.js[39m
app:   1.15 kB            [2mdist/static/[22m[36m8024.fbec35c6.chunk.js[39m
app:   1.15 kB            [2mdist/static/[22m[36m8052.995c8813.chunk.js[39m
app:   1.15 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_oxygene.c7c428a2.chunk.js[39m
app:   1.14 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_aspectj.60137fc5.chunk.js[39m
app:   1.14 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_delphi.b7d25796.chunk.js[39m
app:   1.14 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_lua.634dc76d.chunk.js[39m
app:   1.13 kB            [2mdist/static/[22m[36mmodule-azure.d0bdff62.js[39m
app:   1.12 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_cmake.4f1d7de4.chunk.js[39m
app:   1.12 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_htmlbars.0389e961.chunk.js[39m
app:   1.11 kB            [2mdist/static/[22m[36m4689.986b60ef.chunk.js[39m
app:   1.1 kB             [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_java.d4a8aa00.chunk.js[39m
app:   1.08 kB            [2mdist/static/[22m[36m3499.72d1d0fa.chunk.js[39m
app:   1.07 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_mercury.74dc0336.chunk.js[39m
app:   1.07 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_tcl.10468276.chunk.js[39m
app:   1.07 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_dart.0e7dd6a4.chunk.js[39m
app:   1.06 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_vhdl.293e2fb9.chunk.js[39m
app:   1.06 kB            [2mdist/static/[22m[36m1213.fd91b556.chunk.js[39m
app:   1.05 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_handlebars.f4a2e14a.chunk.js[39m
app:   1.05 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_elixir.9c807a58.chunk.js[39m
app:   1.05 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_vbscript.21abc8e2.chunk.js[39m
app:   1.04 kB            [2mdist/static/[22m[36m2322.aabc45ab.chunk.js[39m
app:   1.04 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_erlang.3790e7f9.chunk.js[39m
app:   1.03 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_asciidoc.538cfc2b.chunk.js[39m
app:   1.02 kB            [2mdist/static/[22m[36m5563.5ddf990f.chunk.js[39m
app:   1.02 kB            [2mdist/static/[22m[36m362.64266864.chunk.js[39m
app:   1.01 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_basic.b59e2a27.chunk.js[39m
app:   1.01 kB            [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_xl.c8ee3c67.chunk.js[39m
app:   994 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_ada.9dfbab09.chunk.js[39m
app:   994 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_django.ff1bafc9.chunk.js[39m
app:   989 B              [2mdist/static/[22m[36m171.23484919.chunk.js[39m
app:   980 B              [2mdist/static/[22m[36m3845.b594de3b.chunk.js[39m
app:   977 B              [2mdist/static/[22m[36m1619.add6264a.chunk.js[39m
app:   972 B              [2mdist/static/[22m[36m6321.21686e48.chunk.js[39m
app:   967 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_gradle.e0798b8b.chunk.js[39m
app:   959 B              [2mdist/static/[22m[36m7629.8a53bb1a.chunk.js[39m
app:   959 B              [2mdist/static/[22m[36m7918.b05fd7fb.chunk.js[39m
app:   950 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_groovy.e554ae08.chunk.js[39m
app:   948 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_moonscript.7581056b.chunk.js[39m
app:   944 B              [2mdist/static/[22m[36m9325.6ead0972.chunk.js[39m
app:   939 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_zephir.2453d584.chunk.js[39m
app:   938 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_tp.4ab58979.chunk.js[39m
app:   922 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_axapta.cc72840d.chunk.js[39m
app:   917 B              [2mdist/static/[22m[36m8620.e49932f3.chunk.js[39m
app:   902 B              [2mdist/static/[22m[36m4377.f14f4e0a.chunk.js[39m
app:   887 B              [2mdist/static/[22m[36m1342.fef78a57.chunk.js[39m
app:   887 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_purebasic.3913848d.chunk.js[39m
app:   873 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_markdown.8cd5c3a0.chunk.js[39m
app:   870 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_angelscript.eb0fc23c.chunk.js[39m
app:   868 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_pf.a17d4f49.chunk.js[39m
app:   861 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_nim.8f3f7ed7.chunk.js[39m
app:   854 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_haxe.51432653.chunk.js[39m
app:   838 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_scilab.85a2f691.chunk.js[39m
app:   838 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_q.92eb6138.chunk.js[39m
app:   832 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_openscad.c9607025.chunk.js[39m
app:   829 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_monkey.c5c5f831.chunk.js[39m
app:   827 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_haskell.ce412d71.chunk.js[39m
app:   827 B              [2mdist/static/[22m[36m3350.44c37475.chunk.js[39m
app:   819 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_rib.65b64f12.chunk.js[39m
app:   818 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_cos.98ca0ce0.chunk.js[39m
app:   817 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_dos.b6fff5cd.chunk.js[39m
app:   812 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_ocaml.5fbb9189.chunk.js[39m
app:   804 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_crmsh.c2927819.chunk.js[39m
app:   789 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_scala.a2ad38d3.chunk.js[39m
app:   784 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_twig.a6d0ccca.chunk.js[39m
app:   780 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_fsharp.456083ec.chunk.js[39m
app:   772 B              [2mdist/static/[22m[36m3019.3478738f.chunk.js[39m
app:   770 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_actionscript.36b0ad6e.chunk.js[39m
app:   769 B              [2mdist/static/[22m[36m9705.6800f5e5.chunk.js[39m
app:   764 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_sml.5d33c4ba.chunk.js[39m
app:   757 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_ceylon.d2943fef.chunk.js[39m
app:   744 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_nginx.3ce64041.chunk.js[39m
app:   730 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_dts.94534bca.chunk.js[39m
app:   726 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_rsl.6978ae8e.chunk.js[39m
app:   711 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_lisp.2cc95e85.chunk.js[39m
app:   691 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_makefile.28ce0145.chunk.js[39m
app:   683 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_ini.bc4f7f17.chunk.js[39m
app:   673 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_go.cca2b0f4.chunk.js[39m
app:   672 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_vala.f8c7c2e4.chunk.js[39m
app:   665 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_dns.99042489.chunk.js[39m
app:   662 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_gcode.39982c37.chunk.js[39m
app:   659 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_cal.0229afc3.chunk.js[39m
app:   656 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_pony.fbe6dc4c.chunk.js[39m
app:   641 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_autohotkey.fecb9e11.chunk.js[39m
app:   635 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_elm.e98d4f70.chunk.js[39m
app:   628 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_smali.12bd1730.chunk.js[39m
app:   611 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_jbossCli.70971c1d.chunk.js[39m
app:   590 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_erlangRepl.6331196f.chunk.js[39m
app:   582 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_haml.4f872a4b.chunk.js[39m
app:   577 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_capnproto.3c435896.chunk.js[39m
app:   576 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_apache.2c6b9e9c.chunk.js[39m
app:   572 B              [2mdist/static/[22m[36m6375.f1bdc8b4.chunk.js[39m
app:   568 B              [2mdist/static/[22m[36m514.a898df58.chunk.js[39m
app:   560 B              [2mdist/static/[22m[36m7492.5ab51238.chunk.js[39m
app:   542 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_protobuf.e4d3458c.chunk.js[39m
app:   537 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_mizar.4fb97ea7.chunk.js[39m
app:   535 B              [2mdist/static/[22m[36m2739.277cf56a.chunk.js[39m
app:   528 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_abnf.d7611bec.chunk.js[39m
app:   519 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_accesslog.b3289634.chunk.js[39m
app:   517 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_nix.bd1633f6.chunk.js[39m
app:   513 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_thrift.fc22411c.chunk.js[39m
app:   513 B              [2mdist/static/[22m[36m3881.042b59bd.chunk.js[39m
app:   506 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_inform7.2cb52eaa.chunk.js[39m
app:   498 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_smalltalk.a827bead.chunk.js[39m
app:   492 B              [2mdist/static/[22m[36m4707.181a9796.chunk.js[39m
app:   491 B              [2mdist/static/[22m[36m6612.47e4cd22.chunk.js[39m
app:   490 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_clean.16d93b2f.chunk.js[39m
app:   487 B              [2mdist/static/[22m[36m9527.c75b5385.chunk.js[39m
app:   487 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_flix.c2848289.chunk.js[39m
app:   485 B              [2mdist/static/[22m[36m997.0e95bbe5.chunk.js[39m
app:   485 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_step21.160e226b.chunk.js[39m
app:   484 B              [2mdist/static/[22m[36m6402.a84c77ca.chunk.js[39m
app:   483 B              [2mdist/static/[22m[36m2275.5062efda.chunk.js[39m
app:   483 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_golo.ea1234ef.chunk.js[39m
app:   477 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_roboconf.b3ec249e.chunk.js[39m
app:   477 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_prolog.a1a792a3.chunk.js[39m
app:   473 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_awk.6439f955.chunk.js[39m
app:   462 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_properties.3a8de5be.chunk.js[39m
app:   444 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_parser3.03a27753.chunk.js[39m
app:   438 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_gherkin.d8ca9bfd.chunk.js[39m
app:   434 B              [2mdist/static/[22m[36m5718.7c8ac3fe.chunk.js[39m
app:   418 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_dockerfile.011c65bb.chunk.js[39m
app:   405 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_profile.d6dbd97e.chunk.js[39m
app:   404 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_subunit.94d11e09.chunk.js[39m
app:   404 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_dust.c3337201.chunk.js[39m
app:   398 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_csp.a7895ae4.chunk.js[39m
app:   395 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_dsconfig.87bc339c.chunk.js[39m
app:   387 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_diff.78ca1305.chunk.js[39m
app:   385 B              [2mdist/static/[22m[36m9791.c8bcc224.chunk.js[39m
app:   385 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_ebnf.0dec13d9.chunk.js[39m
app:   380 B              [2mdist/static/[22m[36m5937.e17c4520.chunk.js[39m
app:   374 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_tap.f54e28d7.chunk.js[39m
app:   353 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_phpTemplate.ade9e28d.chunk.js[39m
app:   346 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_taggerscript.01a1f367.chunk.js[39m
app:   343 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_brainfuck.90e79089.chunk.js[39m
app:   332 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_leaf.e7f0bfe5.chunk.js[39m
app:   321 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_fix.d70f0750.chunk.js[39m
app:   312 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_ldif.ba13bfb6.chunk.js[39m
app:   310 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_mojolicious.d40cbc4c.chunk.js[39m
app:   307 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_bnf.e9b2afc9.chunk.js[39m
app:   298 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_shell.5a041ab7.chunk.js[39m
app:   295 B              [2mdist/static/[22m[36m2722.8e844ac6.chunk.js[39m
app:   288 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_pythonRepl.70282a62.chunk.js[39m
app:   288 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_nodeRepl.ddccaa49.chunk.js[39m
app:   288 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_juliaRepl.2c79bfa9.chunk.js[39m
app:   280 B              [2mdist/static/[22m[36m9866.ac646d49.chunk.js[39m
app:   278 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_erb.fa6e813a.chunk.js[39m
app:   270 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_clojureRepl.aa810f12.chunk.js[39m
app:   251 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_vbscriptHtml.3cc462ae.chunk.js[39m
app:   251 B              [2mdist/static/[22m[36m162.d4822fba.chunk.js[39m
app:   244 B              [2mdist/static/[22m[36m2450.98d6f6b3.chunk.js[39m
app:   229 B              [2mdist/static/[22m[36mreact-syntax-highlighter_languages_highlight_plaintext.32e61c81.chunk.js[39m
app:   146 B              [2mdist/static/[22m[36m1331.920c6ff1.chunk.js[39m
app:   144 B              [2mdist/static/[22m[36m8684.ef5f3ebf.chunk.js[39m
app:   137 B              [2mdist/static/[22m[36m7606.ce4030af.chunk.js[39m
Moving backend into dist workspace
Moving app into dist workspace
Moving @internal/plugin-tenant-registry-backend into dist workspace
Moving @internal/plugin-platform-registry-backend into dist workspace
Moving @internal/plugin-deployment-control-plane-backend into dist workspace
Moving @internal/plugin-platform-common into dist workspace
[0;34m[rebuild][0m Host build artifacts:
[0;34m[rebuild][0m   packages/backend/dist: 20M
[0;34m[rebuild][0m   node_modules:         2.5G
[0;34m[rebuild][0m Timer 'host_build' elapsed: 173s
[0;32m[✓][0m Host build complete
[0;34m[rebuild][0m Building frontend and backend images in parallel

[1m[0;34m════════════════════════════════════════[0m
[1mBuilding Docker Images[0m
[1m[0;34m════════════════════════════════════════[0m
[0;34m[rebuild][0m Build log: /tmp/cloudhub-compose-build.NuoDIn.log
 Image platform_cloudhub-frontend Building 
 Image platform_cloudhub-backend Building 
#1 [internal] load local bake definitions
#1 reading from stdin 1.50kB done
#1 DONE 0.0s

#2 [frontend internal] load build definition from Dockerfile.frontend
#2 transferring dockerfile:
#2 transferring dockerfile: 697B 0.1s done
#2 DONE 0.6s

#3 [backend internal] load build definition from Dockerfile.backend
#3 transferring dockerfile: 3.32kB 0.0s done
#3 DONE 0.7s

#4 [backend] resolve image config for docker-image://docker.io/docker/dockerfile:1.7
#4 DONE 2.7s

#5 [frontend] docker-image://docker.io/docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
#5 resolve docker.io/docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e 0.1s done
#5 CACHED

#5 [backend] docker-image://docker.io/docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
#5 CACHED

#6 [backend internal] load build definition from Dockerfile.backend
#6 transferring dockerfile: 3.32kB done
#6 DONE 0.1s

#7 [frontend internal] load build definition from Dockerfile.frontend
#7 transferring dockerfile: 697B 0.0s done
#7 DONE 0.2s

#8 [frontend internal] load metadata for docker.io/library/nginx:alpine
#8 ...

#9 [backend internal] load metadata for docker.io/library/node:22-bookworm-slim
#9 DONE 1.4s

#8 [frontend internal] load metadata for docker.io/library/nginx:alpine
#8 DONE 1.5s

#10 [backend internal] load .dockerignore
#10 transferring context: 2.19kB 0.0s done
#10 DONE 0.2s

#11 [frontend internal] load .dockerignore
#11 transferring context: 2.19kB done
#11 DONE 0.2s

#12 [backend internal] load build context
#12 ...

#13 [frontend 1/3] FROM docker.io/library/nginx:alpine@sha256:1ed1b0e1d7652937d6cbdaf4018c7b6fc009a7dd6c3047351e2eddda745de43f
#13 resolve docker.io/library/nginx:alpine@sha256:1ed1b0e1d7652937d6cbdaf4018c7b6fc009a7dd6c3047351e2eddda745de43f 0.3s done
#13 DONE 0.3s

#14 [backend stage-0  1/15] FROM docker.io/library/node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
#14 resolve docker.io/library/node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c 0.2s done
#14 DONE 0.3s

#12 [backend internal] load build context
#12 transferring context: 83.26MB 4.7s
#12 ...

#15 [frontend internal] load build context
#15 transferring context: 91.03MB 5.9s done
#15 DONE 6.2s

#12 [backend internal] load build context
#12 ...

#16 [frontend 2/3] COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
#16 CACHED

#12 [backend internal] load build context
#12 transferring context: 122.40MB 7.7s done
#12 DONE 8.0s

#17 [frontend 3/3] COPY packages/app/dist /usr/share/nginx/html
#17 ...

#18 [backend stage-0  2/15] WORKDIR /app
#18 CACHED

#19 [backend stage-0  3/15] RUN --mount=type=cache,target=/var/cache/apt,sharing=locked     --mount=type=cache,target=/var/lib/apt,sharing=locked     apt-get update     && apt-get install -y --no-install-recommends         curl         ca-certificates         libsqlite3-0         libsecret-1-0
#19 CACHED

#20 [backend stage-0  4/15] RUN corepack enable
#20 CACHED

#21 [backend stage-0  5/15] COPY --chown=node:node     package.json     yarn.lock     .yarnrc.yml     backstage.json     ./
#21 CACHED

#22 [backend stage-0  6/15] COPY --chown=node:node .yarn ./.yarn
#22 CACHED

#23 [backend stage-0  7/15] COPY --chown=node:node plugins ./plugins
#23 CACHED

#24 [backend stage-0  8/15] COPY --chown=node:node packages ./packages
#24 CACHED

#25 [backend stage-0  9/15] RUN --mount=type=bind,source=node_modules,target=/tmp/node_modules-src,readonly     && cp -a /tmp/node_modules-src /app/node_modules     && chown -R node:node /app/node_modules
#25 ERROR: failed to calculate checksum of ref vwguy2p3rup6arfm4rkhmon2f::urokg7vfp6dbyvstfo78js4ch: "/node_modules": not found

#17 [frontend 3/3] COPY packages/app/dist /usr/share/nginx/html
#17 CANCELED
------
 > [backend stage-0  9/15] RUN --mount=type=bind,source=node_modules,target=/tmp/node_modules-src,readonly     && cp -a /tmp/node_modules-src /app/node_modules     && chown -R node:node /app/node_modules:
------
target backend: failed to solve: failed to compute cache key: failed to calculate checksum of ref vwguy2p3rup6arfm4rkhmon2f::urokg7vfp6dbyvstfo78js4ch: "/node_modules": not found

[0;31m[✗ ERROR][0m Docker build failed with status 1
[1;33m[⚠][0m Last 50 lines of build log:
  33[0;31m│33[0m #12 ...
  33[0;31m│33[0m 
  33[0;31m│33[0m #15 [frontend internal] load build context
  33[0;31m│33[0m #15 transferring context: 91.03MB 5.9s done
  33[0;31m│33[0m #15 DONE 6.2s
  33[0;31m│33[0m 
  33[0;31m│33[0m #12 [backend internal] load build context
  33[0;31m│33[0m #12 ...
  33[0;31m│33[0m 
  33[0;31m│33[0m #16 [frontend 2/3] COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
  33[0;31m│33[0m #16 CACHED
  33[0;31m│33[0m 
  33[0;31m│33[0m #12 [backend internal] load build context
  33[0;31m│33[0m #12 transferring context: 122.40MB 7.7s done
  33[0;31m│33[0m #12 DONE 8.0s
  33[0;31m│33[0m 
  33[0;31m│33[0m #17 [frontend 3/3] COPY packages/app/dist /usr/share/nginx/html
  33[0;31m│33[0m #17 ...
  33[0;31m│33[0m 
  33[0;31m│33[0m #18 [backend stage-0  2/15] WORKDIR /app
  33[0;31m│33[0m #18 CACHED
  33[0;31m│33[0m 
  33[0;31m│33[0m #19 [backend stage-0  3/15] RUN --mount=type=cache,target=/var/cache/apt,sharing=locked     --mount=type=cache,target=/var/lib/apt,sharing=locked     apt-get update     && apt-get install -y --no-install-recommends         curl         ca-certificates         libsqlite3-0         libsecret-1-0
  33[0;31m│33[0m #19 CACHED
  33[0;31m│33[0m 
  33[0;31m│33[0m #20 [backend stage-0  4/15] RUN corepack enable
  33[0;31m│33[0m #20 CACHED
  33[0;31m│33[0m 
  33[0;31m│33[0m #21 [backend stage-0  5/15] COPY --chown=node:node     package.json     yarn.lock     .yarnrc.yml     backstage.json     ./
  33[0;31m│33[0m #21 CACHED
  33[0;31m│33[0m 
  33[0;31m│33[0m #22 [backend stage-0  6/15] COPY --chown=node:node .yarn ./.yarn
  33[0;31m│33[0m #22 CACHED
  33[0;31m│33[0m 
  33[0;31m│33[0m #23 [backend stage-0  7/15] COPY --chown=node:node plugins ./plugins
  33[0;31m│33[0m #23 CACHED
  33[0;31m│33[0m 
  33[0;31m│33[0m #24 [backend stage-0  8/15] COPY --chown=node:node packages ./packages
  33[0;31m│33[0m #24 CACHED
  33[0;31m│33[0m 
  33[0;31m│33[0m #25 [backend stage-0  9/15] RUN --mount=type=bind,source=node_modules,target=/tmp/node_modules-src,readonly     && cp -a /tmp/node_modules-src /app/node_modules     && chown -R node:node /app/node_modules
  33[0;31m│33[0m #25 ERROR: failed to calculate checksum of ref vwguy2p3rup6arfm4rkhmon2f::urokg7vfp6dbyvstfo78js4ch: "/node_modules": not found
  33[0;31m│33[0m 
  33[0;31m│33[0m #17 [frontend 3/3] COPY packages/app/dist /usr/share/nginx/html
  33[0;31m│33[0m #17 CANCELED
  33[0;31m│33[0m ------
  33[0;31m│33[0m  > [backend stage-0  9/15] RUN --mount=type=bind,source=node_modules,target=/tmp/node_modules-src,readonly     && cp -a /tmp/node_modules-src /app/node_modules     && chown -R node:node /app/node_modules:
  33[0;31m│33[0m ------
  33[0;31m│33[0m target backend: failed to solve: failed to compute cache key: failed to calculate checksum of ref vwguy2p3rup6arfm4rkhmon2f::urokg7vfp6dbyvstfo78js4ch: "/node_modules": not found
  33[0;31m│33[0m 
[0;31m[✗ ERROR][0m Image build phase failed
