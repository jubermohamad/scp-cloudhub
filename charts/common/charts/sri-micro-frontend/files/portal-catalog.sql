-- Applications catalog — the header mega menu + landing pillars + resources
-- read these tables (src/lib/catalog.ts). EVERYTHING is data: labels,
-- descriptions, redirect URLs, the "Go to" target, icons, and the
-- not-available BADGE text. Adding/removing an app or module is an INSERT
-- or an `UPDATE … enabled=false` here — never a code change.
--
-- Idempotent: run against the `portal` database as its owner; re-running
-- refreshes the seed.
--
-- href (redirect URL) — DB WINS, both modes in one column:
--   literal ('https://…' or '/path')  → used as-is (put the whole URL here)
--   ${ENV_VAR} template               → resolved from the pod env at read
--                                        time (keeps one DB portable across
--                                        environments)
--   NULL                              → no link; the `badge` text shows
-- env_gate  optional: a var that must be non-empty or the module shows its
--           badge (use with relative/templated hrefs; unneeded for literals)
-- badge     text shown when there's no resolved link ("Soon", "Beta", …)
-- go_primary marks the application's "Go to <label>" button target
-- icon      landing pillar icon key (data | detection | investigation;
--           unknown keys get a neutral default)

CREATE TABLE IF NOT EXISTS catalog_applications (
  key         text PRIMARY KEY,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon        text NOT NULL DEFAULT 'default',
  sort_order  int  NOT NULL DEFAULT 100,
  enabled     boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS catalog_modules (
  id              serial PRIMARY KEY,
  application_key text NOT NULL REFERENCES catalog_applications(key) ON DELETE CASCADE,
  label           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  href            text,
  external        boolean NOT NULL DEFAULT false,
  env_gate        text,
  go_primary      boolean NOT NULL DEFAULT false,
  badge           text NOT NULL DEFAULT 'Soon',
  -- Internal .svc URL the portal's server-side proxy reverse-proxies to for
  -- a same-origin MFE embed (never seen by the browser). Lets a new embedded
  -- app's target be a DB row instead of a pod env var.
  embed_upstream  text,
  sort_order      int NOT NULL DEFAULT 100,
  enabled         boolean NOT NULL DEFAULT true,
  UNIQUE (application_key, label)
);

-- Add columns to a pre-existing install (no-op if already present).
ALTER TABLE catalog_modules ADD COLUMN IF NOT EXISTS badge text NOT NULL DEFAULT 'Soon';
ALTER TABLE catalog_modules ADD COLUMN IF NOT EXISTS embed_upstream text;

CREATE TABLE IF NOT EXISTS catalog_resources (
  id          serial PRIMARY KEY,
  title       text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  href        text,
  external    boolean NOT NULL DEFAULT false,
  env_gate    text,
  cta         text NOT NULL DEFAULT 'Open',
  badge       text NOT NULL DEFAULT 'Coming soon',
  sort_order  int NOT NULL DEFAULT 100,
  enabled     boolean NOT NULL DEFAULT true
);
ALTER TABLE catalog_resources ADD COLUMN IF NOT EXISTS badge text NOT NULL DEFAULT 'Coming soon';

-- ── Seed ─────────────────────────────────────────────────────────────────

INSERT INTO catalog_applications (key, title, description, icon, sort_order) VALUES
  ('sri-data',          'SRI Data',          'Manage, govern, and connect your risk data with less friction',        'data',          10),
  ('sri-detection',     'SRI Detection',     'Detect and triage financial crime signals in real time',               'detection',     20),
  ('sri-investigation', 'SRI Investigation', 'Investigate entities and their networks across your risk landscape',   'investigation', 30)
ON CONFLICT (key) DO UPDATE
  SET title = EXCLUDED.title, description = EXCLUDED.description,
      icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order;

-- This is a MICRO-FRONTEND platform: modules are SAME-ORIGIN routes that
-- embed under the portal (/ontology, /pipeline, /command-centre), NOT
-- redirects out to a standalone app host. So hrefs are relative and
-- external=false; env_gate names the proxy env var that must be set for
-- the embed to be live (else the badge shows). (A literal external URL is
-- still allowed by the resolver for the rare non-embedded case — put the
-- full https:// URL in href with external=true — but the norm is MFE.)
INSERT INTO catalog_modules
  (application_key, label, description, href, external, env_gate, go_primary, badge, sort_order) VALUES
  ('sri-data', 'Ontology Studio',
   'A shared concept model of everything your institution reasons about',
   '/ontology', false, 'LENS_CONSOLE_URL', true, 'Soon', 10),
  ('sri-data', 'Pipeline',
   'Configure blueprints and outcomes, monitor every execution',
   '/pipeline', false, NULL, false, 'Soon', 20),
  ('sri-data', 'Data Sources',
   'Register the databases, APIs, and files your pipelines read from',
   '/pipeline?path=/data-sources', false, NULL, false, 'Soon', 30),
  ('sri-detection', 'Command Centre',
   'Role-aware operations view: signal feed, pipeline health, controls',
   '/command-centre', false, NULL, true, 'Soon', 10),
  ('sri-detection', 'Fraud', 'Fraud detection workflows',    NULL, false, NULL, false, 'Soon', 20),
  ('sri-detection', 'KYC',   'Know-your-customer workflows',  NULL, false, NULL, false, 'Soon', 30),
  ('sri-investigation', 'Risk Intelligence Graph',
   'Traverse relationships and build the case from connected evidence',
   '/graph', false, 'GRAPH_CONSOLE_URL', false, 'Soon', 10)
ON CONFLICT (application_key, label) DO UPDATE
  SET description = EXCLUDED.description, href = EXCLUDED.href,
      external = EXCLUDED.external, env_gate = EXCLUDED.env_gate,
      go_primary = EXCLUDED.go_primary, badge = EXCLUDED.badge,
      sort_order = EXCLUDED.sort_order;

-- Pipeline AND Data Sources are served by the same fin-pipeline UI service
-- and embed SAME-ORIGIN; the proxy upstream (internal .svc) lives in the DB
-- so pointing them at a service is a metadata change. Adjust host per env.
-- embed_upstream is an operator-supplied URL the PORTAL fetches server-side
-- (SSRF-by-design) — keep it an in-cluster .svc target; DB-write == operator.
-- `${VAR}` is resolved by the PORTAL at read time from its own env (the same
-- mechanism every href in this catalog uses), so this stays portable across
-- environments. It used to name `pipeline-ui-svc.sri-dev-fin-pipeline.svc` —
-- a namespace that exists in no installation of this platform, and a service
-- name the naming migration has since moved. A literal here can only ever be
-- right for one cluster; the env var is right for all of them.
UPDATE catalog_modules
  SET embed_upstream = '${PIPELINE_UI_SVC_URL}'
  WHERE application_key = 'sri-data' AND label IN ('Pipeline', 'Data Sources');

INSERT INTO catalog_resources (title, description, href, env_gate, cta, badge, sort_order) VALUES
  ('Getting started with Command Centre',
   'Six role-aware views over one operations screen — where to start for operators, analysts, and investigators.',
   '/command-centre', NULL, 'Open', 'Coming soon', 10),
  ('Modelling your risk ontology',
   'Concepts, relationships, and bindings — how the shared ontology keeps every application speaking the same language.',
   '/ontology', 'LENS_CONSOLE_URL', 'Explore', 'Coming soon', 20),
  ('Resource library',
   'Browse all resources: product guides, release notes, and best-practice playbooks for the SRI platform.',
   NULL, NULL, 'Open', 'Coming soon', 30)
ON CONFLICT (title) DO UPDATE
  SET description = EXCLUDED.description, href = EXCLUDED.href,
      env_gate = EXCLUDED.env_gate, cta = EXCLUDED.cta,
      badge = EXCLUDED.badge, sort_order = EXCLUDED.sort_order;

-- Example — adding a whole new MFE application later, zero code changes
-- (embed it same-origin at /screening behind the portal, gated on its
-- proxy env var; a new pillar row + module row is all it takes):
--   INSERT INTO catalog_applications (key, title, description, icon, sort_order)
--     VALUES ('sri-screening', 'SRI Screening', 'Sanctions & watchlist screening', 'detection', 40);
--   INSERT INTO catalog_modules (application_key, label, description, href, env_gate, go_primary, badge, sort_order)
--     VALUES ('sri-screening', 'Screening Console', 'Screen parties against watchlists',
--             '/screening', 'SCREENING_UI_SVC_URL', true, 'Beta', 10);
