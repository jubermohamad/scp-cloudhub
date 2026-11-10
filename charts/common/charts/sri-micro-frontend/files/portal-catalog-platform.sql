-- ═══════════════════════════════════════════════════════════════════════════
--  THE PLATFORM MAP — every UI this platform serves, as data.
--
--  Applied by templates/ensure-portal-catalog.yaml (post-install/post-upgrade)
--  on top of the upstream schema+seed (db/portal-catalog.sql). Every statement
--  is ON CONFLICT DO UPDATE, so it refreshes on every upgrade and can be
--  re-run at will — the upstream seed's own semantics.
--
--  Three modes per row:
--    embed    href = /route + embed_upstream = an IN-CLUSTER .svc URL the
--             portal reverse-proxies server-side (same-origin, one URL). The
--             browser never sees the upstream.
--    literal  href = ${ENV_VAR} template, external = true. The pod carries the
--             per-environment host, so the seed stays portable.
--    badge    href IS NULL -> the portal renders the badge, not a link.
--
--  THE MENU IS A MAP OF *THIS* INSTALLATION, not a product brochure. Row
--  `enabled` is stamped from the SAME switches that decide what gets installed
--  (portalCatalog.installed.*, fed from the switchboard), so a product that is
--  not installed does not appear. The row is kept and DISABLED rather than
--  deleted: installing that product later just flips the flag, which keeps the
--  seed idempotent — an absent row would make an addition a schema change.
--
--  A pillar with no enabled modules disables itself, so an uninstalled domain
--  vanishes from the menu entirely rather than showing an empty heading.
--
--  EMBEDDING STATUS: an app is embedded once it is proven to emit its asset and
--  API URLs under the portal's prefix. That holds for the Lens console, the
--  Pipeline UI, Help, the API docs, pgAdmin, Kafka UI and — with MinIO's own
--  MINIO_BROWSER_REDIRECT_URL doing the work on the upstream side — the Object
--  Store Console. Everything else stays a literal external link, which is also
--  the auth fallback, until its verdict is established. See
--  docs/PORTAL-EMBEDDING.md for the per-app verdict table.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── pillars ────────────────────────────────────────────────────────────────
-- The three product keys are deliberately the marketplace's own identifiers
-- (sri-data / sri-detection / sri-investigation), so a later release can seed
-- this catalog straight from the SKUs an installation selected. `sri-platform`
-- is added for the operator-facing consoles: they belong to the platform
-- itself rather than to any product, and grouping them apart keeps a business
-- user's menu free of database and broker admin tools.
INSERT INTO catalog_applications (key, title, description, icon, sort_order, enabled) VALUES
  ('sri-data',          'Data',
   'The shared concept model, the pipelines that fill it, and the sources it is fed from',
   'data', 10, {{ and .Values.portalCatalog.installed.data (or .Values.portalCatalog.installed.ontology .Values.portalCatalog.installed.pipeline .Values.portalCatalog.installed.finDataService .Values.portalCatalog.installed.dxv) }}),
  ('sri-detection',     'Detection',
   'Signals, models and the operations view that acts on them',
   'detection', 20, {{ and .Values.portalCatalog.installed.detection (or .Values.portalCatalog.installed.detectionhub .Values.portalCatalog.installed.aiStore) }}),
  ('sri-investigation', 'Investigation',
   'Cases, disclosures and the connected evidence behind them',
   'investigation', 30, {{ and .Values.portalCatalog.installed.investigation .Values.portalCatalog.installed.invhub }}),
  ('sri-platform',      'Operations',
   'Platform consoles for the people who run it: identity, data stores, brokers, registries',
   'default', 90, {{ or .Values.portalCatalog.installed.keycloak .Values.portalCatalog.installed.minioConsole .Values.portalCatalog.installed.pgadmin .Values.portalCatalog.installed.kafkaUi }})
ON CONFLICT (key) DO UPDATE
  SET title = EXCLUDED.title, description = EXCLUDED.description,
      icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order,
      enabled = EXCLUDED.enabled;

-- ── modules ────────────────────────────────────────────────────────────────
INSERT INTO catalog_modules
  (application_key, label, description, href, external, env_gate, go_primary,
   badge, embed_upstream, sort_order, enabled) VALUES

  -- ── DATA ─────────────────────────────────────────────────────────────────
  -- RETIRED with Lens (2026-08-24): `installed.ontology` is false everywhere,
  -- so this row stays in the catalogue but renders disabled. Kept rather than
  -- deleted so re-enabling Lens to read old data brings its tile back.
  ('sri-data', 'Ontology Studio',
   'The shared concept model of everything your institution reasons about',
   '/ontology', false, 'LENS_CONSOLE_URL', true, 'Soon',
   '${LENS_CONSOLE_URL}', 10, {{ .Values.portalCatalog.installed.ontology }}),
  -- Its replacement. EXTERNAL, not an embed: prism's console serves /rigraph/
  -- and /chat/ beneath its own root, which the portal's same-origin proxy at a
  -- sub-path cannot satisfy without a prefix change on prism's side.
  -- BADGED until that and, more importantly, until prism has authentication —
  -- it ships no OIDC client today, so the gate (PRISM_CONSOLE_URL, unset until
  -- an environment wires it) is what stops the portal publishing an
  -- unauthenticated app.
  -- THE GRAPH LIVES UNDER DATA, not Investigation. prism is a data product — it
  -- is installed as data.sensa-data-foundational-platform and its resources are
  -- named sri-<env>-data-prism-* — and the graph it serves is the shared model
  -- every other product reasons about, not a case-work surface. The Investigation
  -- copy of this tile was a placeholder for a console that never existed; it is
  -- DELETEd below.
  ('sri-data', 'Risk Intelligence Graph',
   'Traverse entities, relationships and the records behind them',
   '${PRISM_CONSOLE_URL}', true, 'PRISM_CONSOLE_URL', false, 'Soon',
   NULL, 11, {{ .Values.portalCatalog.installed.foundationalPlatform }}),
  -- EMBEDDED: fin-pipeline's UI through the portal's proxy
  ('sri-data', 'Pipeline',
   'Configure blueprints and outcomes, and monitor every execution',
   '/pipeline', false, 'PIPELINE_UI_SVC_URL', false, 'Soon',
   '${PIPELINE_UI_SVC_URL}', 20, {{ .Values.portalCatalog.installed.pipeline }}),
  ('sri-data', 'Data Sources',
   'Register the databases, APIs and files your pipelines read from',
   '/pipeline?path=/data-sources', false, 'PIPELINE_UI_SVC_URL', false, 'Soon',
   '${PIPELINE_UI_SVC_URL}', 30, {{ .Values.portalCatalog.installed.pipeline }}),
  -- EXTERNAL: assembly is its own host (own realm, own login) — a new-tab
  -- link, not a same-origin embed. env_gate keeps it a badge until the
  -- ASSEMBLY_UI_URL env var is wired (i.e. assembly is actually reachable).
  ('sri-data', 'Assembly',
   'Design, run and monitor agentic workflows over your risk data',
   '${ASSEMBLY_UI_URL}', true, 'ASSEMBLY_UI_URL', false, 'Soon',
   NULL, 40, {{ .Values.portalCatalog.installed.assembly }}),

  -- ── DETECTION ────────────────────────────────────────────────────────────
  ('sri-detection', 'Command Centre',
   'Role-aware operations view: signal feed, pipeline health, controls',
   '/command-centre', false, NULL, true, 'Soon', NULL, 10, {{ .Values.portalCatalog.installed.detection }}),
  ('sri-detection', 'Detection Hub',
   'Alerts, cases and the detection workflows behind them',
   '${DETHUB_UI_URL}/smc2', true, 'DETHUB_UI_URL', false, 'Soon', NULL, 20, {{ .Values.portalCatalog.installed.detectionhub }}),
  ('sri-detection', 'Dashboards',
   'Superset dashboards over the detection data',
   '${SUPERSET_UI_URL}', true, 'SUPERSET_UI_URL', false, 'Soon', NULL, 30, {{ .Values.portalCatalog.installed.detectionhub }}),
  ('sri-detection', 'AI Store',
   'Register, version and deploy the models and agents that produce signals',
   '${AISTORE_UI_URL}', true, 'AISTORE_UI_URL', false, 'Soon', NULL, 40, {{ .Values.portalCatalog.installed.aiStore }}),
  ('sri-detection', 'Experiment Tracking',
   'MLflow runs, metrics and artefacts behind the models',
   '${MLFLOW_UI_URL}', true, 'MLFLOW_UI_URL', false, 'Soon', NULL, 50, {{ .Values.portalCatalog.installed.aiStore }}),
  -- Model Registry (zot), Agent Gateway (MCP) and Detection External API used
  -- to live here. They are machine endpoints, not applications — see the
  -- DELETE below for the evidence. "Applications" lists things a human can
  -- open; a row that can only ever answer a token or a protocol handshake
  -- renders as a link that 404s in a browser.

  -- ── INVESTIGATION ────────────────────────────────────────────────────────
  ('sri-investigation', 'Investigation Hub',
   'Case management and the investigator workspace',
   '${INVHUB_UI_URL}', true, 'INVHUB_UI_URL', true, 'Soon', NULL, 10, {{ .Values.portalCatalog.installed.invhub }}),
  ('sri-investigation', 'Disclosures',
   'Draft, review and file regulatory disclosures',
   '${INVHUB_UI_URL}/disclosures-web', true, 'INVHUB_UI_URL', false, 'Soon', NULL, 20, {{ .Values.portalCatalog.installed.invhub }}),
  -- Copilot used to live here, pointing at COPILOT_UI_URL — which is the
  -- interaction ENGINE's host, an API. The copilot itself is a capability
  -- inside the Investigation Hub case UI, not a separate application, so the
  -- Investigation Hub row above already reaches it. See the DELETE below.
  ('sri-investigation', 'Reporting',
   'Case and workload reporting dashboards',
   '${INVHUB_UI_URL}/reporting', true, 'INVHUB_UI_URL', false, 'Soon', NULL, 40, {{ .Values.portalCatalog.installed.invhub }}),
  -- Notifications used to live here. It is a websocket endpoint with no root
  -- route (invhub's api-ws service) — it is what makes live notifications
  -- appear INSIDE Investigation Hub, and has no page of its own.
  -- EMBEDDED: static, already path-served at /help by invhub's docs nginx
  ('sri-investigation', 'Help Centre',
   'In-product guidance for investigators',
   '/help', false, 'INVHUB_HELP_URL', false, 'Soon',
   '${INVHUB_HELP_URL}', 60, {{ .Values.portalCatalog.installed.invhub }}),

  -- ── OPERATIONS (platform consoles) ───────────────────────────────────────
  -- Each of these is ADMIN ONLY and says so in its description: the portal has
  -- no role awareness yet, so the description is the only signal a business
  -- user gets. When roles land, these rows are the hook (future work).
  ('sri-platform', 'Identity (Keycloak)',
   'ADMIN ONLY — realms, clients and users for every product''s sign-in',
   '${KEYCLOAK_URL}', true, 'KEYCLOAK_URL', false, 'Admin', NULL, 10, {{ .Values.portalCatalog.installed.keycloak }}),
  -- EMBEDDED, same own-login caveat as pgAdmin and Kafka UI below — and the
  -- only embed that needs a change on the UPSTREAM as well as in the portal:
  -- common.minio's MINIO_BROWSER_REDIRECT_URL is what makes the console emit
  -- its assets under /minio instead of the origin root. Without it this row
  -- renders a frame with no styling and no API. KNOWN GAP: listing the objects
  -- INSIDE a bucket rides a WebSocket the proxy cannot carry; sign-in, the
  -- bucket list and the admin pages work.
  ('sri-platform', 'Object Store Console',
   'ADMIN ONLY — buckets, policies and users of the platform object store',
   '/minio', false, 'MINIO_CONSOLE_SVC_URL', false, 'Admin',
   '${MINIO_CONSOLE_SVC_URL}', 20, {{ .Values.portalCatalog.installed.minioConsole }}),
  -- EMBEDDED, but it keeps its OWN login inside the frame: platform SSO for
  -- the operator consoles is parked (docs/OPS-CONSOLE-SSO.md). Its session
  -- cookie is already Path-scoped to /pgadmin, which is what makes it safe.
  ('sri-platform', 'Database Console (pgAdmin)',
   'ADMIN ONLY — direct query access to the platform databases',
   '/pgadmin', false, 'PGADMIN_SVC_URL', false, 'Admin',
   '${PGADMIN_SVC_URL}', 30, {{ .Values.portalCatalog.installed.pgadmin }}),
  -- EMBEDDED, same caveat as pgAdmin above: its own login, Path-scoped cookie
  ('sri-platform', 'Event Broker (Kafka UI)',
   'ADMIN ONLY — topics, consumer groups and message flow',
   '/kafka-ui', false, 'KAFKA_UI_SVC_URL', false, 'Admin',
   '${KAFKA_UI_SVC_URL}', 40, {{ .Values.portalCatalog.installed.kafkaUi }}),
  -- Only meaningful where DXV still runs its OWN bundled object store. On the
  -- SRI platform it does not: P11 folded dxv-minio into the platform store, so
  -- dxv's buckets are served by the Object Store Console row above and this row
  -- is switched off (portalCatalog.installed.dxvConsole: false).
  ('sri-platform', 'Data Exchange Console',
   'ADMIN ONLY — the DXV appliance''s own object store console, where DXV runs a bundled store; not published outside the cluster',
   NULL, false, NULL, false, 'In-cluster only', NULL, 50, {{ .Values.portalCatalog.installed.dxvConsole }}),
  ('sri-platform', 'Marketplace',
   'What this environment has installed, and what else can be — the provisioner''s catalogue',
   '${MARKETPLACE_URL}', true, 'MARKETPLACE_URL', false, 'Coming soon', NULL, 60, {{ .Values.portalCatalog.installed.marketplace }})

ON CONFLICT (application_key, label) DO UPDATE
  SET description = EXCLUDED.description, href = EXCLUDED.href,
      external = EXCLUDED.external, env_gate = EXCLUDED.env_gate,
      go_primary = EXCLUDED.go_primary, badge = EXCLUDED.badge,
      embed_upstream = EXCLUDED.embed_upstream,
      sort_order = EXCLUDED.sort_order, enabled = EXCLUDED.enabled;

-- The upstream seed ships placeholder rows for products this platform does not
-- have; drop them so the menu is not half real, half aspirational.
DELETE FROM catalog_modules
 WHERE application_key = 'sri-detection' AND label IN ('Fraud', 'KYC');

-- APIs ARE NOT APPLICATIONS. "Applications" is a menu of things a person can
-- open in a browser; these five rows were machine endpoints, so every one of
-- them rendered as a link that 404s for the human who clicked it. Removing
-- them from the INSERT is not enough — ON CONFLICT DO UPDATE only touches
-- rows still listed, so an already-seeded row would survive forever. Hence
-- these DELETEs. Verified live before removal, one at a time:
--
--   Model Registry (zot)     zot v2.1.15 with NO ui/search extension: /,
--                            /home, /explore, /zot and /_zot/ui all return
--                            '404 page not found' (text/plain). Only /v2/
--                            answers (401) — the OCI API. No UI exists to
--                            point at, so this is a removal, not a re-point.
--   Agent Gateway (MCP)      401 {"detail":"Invalid or missing bearer token"}.
--                            An MCP protocol endpoint for agents, not a page.
--   Detection External API   Spring 404 JSON at /, no root mapping. It is the
--                            outward-facing REST API for other systems.
--   Copilot                  Pointed at the interaction ENGINE host, which
--                            answers {"detail":"Not Found"}. The copilot is a
--                            feature inside the Investigation Hub case UI —
--                            no separate ingress path for a copilot UI exists
--                            — so Investigation Hub already covers it.
--   Notifications            invhub's api-ws service: a websocket endpoint
--                            with no root route. It powers live notifications
--                            INSIDE Investigation Hub; it is not a page.
--
-- ALSO removed, on the user's explicit instruction ("api not need in ui"): the
-- three API DOCS viewers — Ontology API docs (/docs), GraphQL API docs
-- (/docs-graphql) and REST API docs (/docs-api). An earlier revision of this
-- file argued they should stay, on the grounds that a docs viewer IS a user
-- interface a human reads in a browser. That reasoning was overruled: the rule
-- is that Applications lists PRODUCTS, and an API reference — however nicely
-- rendered — is developer material, not an application a business user opens.
--
-- The /docs, /docs-graphql and /docs-api PROXY ROUTES are deliberately LEFT IN
-- PLACE and still work (they return 200/307 behind the SSO gate). Only the
-- catalog rows are gone, so nothing is broken for anyone holding a link, and
-- restoring them later is a row insert rather than a rebuild. If they should be
-- discoverable without cluttering Applications, `catalog_resources` (the
-- portal's "Resources" nav) is the natural home — that is a deliberate future
-- choice, not an oversight.
DELETE FROM catalog_modules
 WHERE (application_key = 'sri-detection'
        AND label IN ('Model Registry', 'Agent Gateway (MCP)',
                      'Detection External API'))
    OR (application_key = 'sri-investigation'
        AND label IN ('Copilot', 'Notifications',
                      'GraphQL API docs', 'REST API docs'))
    -- The graph moved to SRI Data (see the row above). Two rows to remove, not
    -- one: the Investigation placeholder, which was gated on a GRAPH_CONSOLE_URL
    -- nothing ever set, and the Data row's OLD label — catalog_modules is unique
    -- on (application_key, label), so renaming a tile leaves the previous name
    -- behind as an orphan that would keep rendering.
    OR (application_key = 'sri-investigation' AND label = 'Risk Intelligence Graph')
    OR (application_key = 'sri-data' AND label = 'Foundational Platform')
    OR (application_key = 'sri-data'
        AND label IN ('Ontology API docs',
                      -- no UI AT ALL, and their own badges said so ("API only",
                      -- "SFTP only"): a NULL href rendered them as inert
                      -- greyed-out text a user cannot act on. Installed and
                      -- healthy, simply not applications — the products they
                      -- feed (Pipeline, Ontology Studio) are the surfaces a
                      -- human actually opens.
                      'Financial Data Service', 'Data Exchange (DXV)',
                      -- a second entry for a console already listed, differing
                      -- only in opening it at its own external host instead of
                      -- inside the portal shell. One product, one row: the
                      -- duplicate invited the question "which of these two do I
                      -- click?", and the whole point of the portal is that
                      -- everything is reached through the one URL.
                      'Ontology Studio (full window)'));

-- ── landing resources (upstream's rows are kept; this is an addition) ──────
INSERT INTO catalog_resources (title, description, href, external, env_gate, cta, badge, sort_order, enabled) VALUES
  ('Environment map',
   'Which products are installed here, at which versions, and where they live',
   NULL, false, NULL, 'Open', 'Coming soon', 200, true)
ON CONFLICT (title) DO UPDATE
  SET description = EXCLUDED.description, href = EXCLUDED.href,
      external = EXCLUDED.external, env_gate = EXCLUDED.env_gate,
      cta = EXCLUDED.cta, badge = EXCLUDED.badge,
      sort_order = EXCLUDED.sort_order, enabled = EXCLUDED.enabled;

-- AN ENABLED MODULE IS NOT "SOON". Every row above seeds badge='Soon'
-- unconditionally, with the installed flag driving only `enabled` — so a fully
-- installed platform rendered every product tile as coming-soon, and the first
-- operator to log in asked, reasonably, where the apps were. The install state
-- is already expressed row-by-row in `enabled`; deriving the badge from it here
-- keeps one source of truth instead of templating the same flag into two
-- columns. Badge is NOT NULL by schema, so cleared means ''. Admin and
-- In-cluster-only badges are statements about ACCESS, not readiness — untouched.
UPDATE catalog_modules SET badge = '' WHERE enabled AND badge = 'Soon';
