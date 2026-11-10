"""Tests for GitHub Actions workflows."""
from __future__ import annotations

import unittest
from pathlib import Path

import yaml

from tests._helpers import LIVE_INFRA_DIR, REPO_ROOT, read

CLUSTER_WF = LIVE_INFRA_DIR / ".github" / "workflows"
HELM_WF = REPO_ROOT / "cloudhub-platform-helm-charts" / ".github" / "workflows"


def load(path: Path) -> dict:
    return yaml.safe_load(read(path))


class TestPlanClusterWorkflow(unittest.TestCase):
    wf = CLUSTER_WF / "plan-cluster.yaml"

    def setUp(self):
        self.doc = load(self.wf)

    def test_dispatch_inputs(self):
        # `on:` is a Python truthy "on" reserved keyword — yaml loads it as True.
        on = self.doc.get(True) or self.doc.get("on")
        self.assertIn("workflow_dispatch", on)
        inputs = on["workflow_dispatch"]["inputs"]
        self.assertIn("workspace", inputs)
        self.assertTrue(inputs["workspace"]["required"])

    def test_runs_terraform_plan(self):
        steps = self.doc["jobs"]["plan"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("terraform plan", runs)
        self.assertIn("terraform init", runs)

    def test_uses_arm_oidc_env(self):
        env = self.doc["env"]
        # GitHub Actions env values are strings; "true" is canonical.
        self.assertIn(str(env.get("ARM_USE_OIDC")).lower(), ("true",))
        for k in ("ARM_CLIENT_ID", "ARM_TENANT_ID", "ARM_SUBSCRIPTION_ID"):
            self.assertIn(k, env)


class TestApplyClusterWorkflow(unittest.TestCase):
    wf = CLUSTER_WF / "apply-cluster.yaml"

    def setUp(self):
        self.doc = load(self.wf)

    def test_apply_environment_gated(self):
        apply_job = self.doc["jobs"]["apply"]
        self.assertIn("environment", apply_job)

    def test_runs_terraform_apply(self):
        steps = self.doc["jobs"]["apply"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("terraform apply", runs)

    def test_prod_guard_present(self):
        guard = self.doc["jobs"]["guard"]["steps"][0]["run"]
        self.assertIn("prod", guard)
        self.assertIn("exit 1", guard)


class TestProvisionClusterWorkflow(unittest.TestCase):
    wf = CLUSTER_WF / "provision-cluster.yaml"

    def setUp(self):
        self.doc = load(self.wf)

    def test_triggers_on_pr_and_push(self):
        on = self.doc.get(True) or self.doc.get("on")
        self.assertIn("pull_request", on)
        self.assertIn("push", on)

    def test_detects_changed_tfvars(self):
        detect = self.doc["jobs"]["detect"]["steps"]
        runs = " ".join(s.get("run", "") for s in detect)
        self.assertIn("values/", runs)
        self.assertIn(".tfvars", runs)


class TestPlanApplicationWorkflow(unittest.TestCase):
    wf = HELM_WF / "plan-application.yaml"

    def setUp(self):
        self.doc = load(self.wf)

    def test_runs_helm_template_and_diff(self):
        steps = self.doc["jobs"]["plan"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("helm template", runs)
        self.assertIn("helm diff", runs)
        # No imperative create-namespace.
        self.assertNotIn("kubectl create namespace", runs)


class TestDeployApplicationWorkflow(unittest.TestCase):
    wf = HELM_WF / "deploy-application.yaml"

    def setUp(self):
        self.doc = load(self.wf)

    def test_uses_helm_upgrade_install(self):
        steps = self.doc["jobs"]["deploy"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("helm upgrade --install", runs)

    def test_no_imperative_namespace_create(self):
        steps = self.doc["jobs"]["deploy"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertNotIn("kubectl create namespace", runs)
        # `--create-namespace` (helm flag) is allowed and required.
        self.assertIn("--create-namespace", runs)

    def test_validates_rollout(self):
        steps = self.doc["jobs"]["deploy"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("rollout status", runs)


class TestBuildAndPushImagesWorkflow(unittest.TestCase):
    wf = REPO_ROOT / ".github" / "workflows" / "build-fe-be-prod-basic.yml"

    def setUp(self):
        self.doc = load(self.wf)

    def test_manual_trigger_only(self):
        on = self.doc.get(True) or self.doc.get("on")
        # No push/PR triggers: this workflow only builds and pushes on demand or
        # when reused by release-production.yml.
        self.assertEqual(set(on.keys()), {"workflow_dispatch", "workflow_call"})
        inputs = on["workflow_dispatch"]["inputs"]
        self.assertIn("image_tag", inputs)
        self.assertIn("frontend_tag", inputs)
        self.assertIn("backend_tag", inputs)
        self.assertIn("push_latest", inputs)
        self.assertIn("versioning_mode", inputs)
        self.assertFalse(inputs["image_tag"]["required"])

    def test_builds_only_and_never_deploys(self):
        text = read(self.wf)
        for forbidden in ("az webapp config container set", "az webapp restart", "az webapp auth"):
            self.assertNotIn(forbidden, text)

    def test_exposes_image_outputs_for_reuse(self):
        on = self.doc.get(True) or self.doc.get("on")
        outputs = on["workflow_call"]["outputs"]
        self.assertEqual(
            set(outputs.keys()),
            {"image_version", "frontend_tag", "backend_tag", "frontend_image", "backend_image"},
        )

    def test_required_secret_envs_present(self):
        env = self.doc["env"]
        for key in (
            "REGISTRY",
            "ACR_NAME",
        ):
            self.assertIn(key, env)

    def test_uses_required_actions_and_files(self):
        steps = self.doc["jobs"]["build-and-push"]["steps"]
        uses = " ".join(s.get("uses", "") for s in steps)
        runs = " ".join(s.get("run", "") for s in steps)
        build_steps = [s for s in steps if s.get("uses", "").startswith("docker/build-push-action")]
        self.assertIn("actions/checkout@v5", uses)
        self.assertIn("docker/setup-buildx-action@v4", uses)
        self.assertIn("az login", runs)
        self.assertIn("az acr login", runs)
        self.assertEqual(build_steps[0]["with"]["file"], "docker/Dockerfile.backend")
        self.assertEqual(build_steps[1]["with"]["file"], "docker/Dockerfile.frontend")
        self.assertIn("Workflow build revision", runs)

    def test_frontend_build_urls_validated_before_bake(self):
        # app.baseUrl is baked into the static-asset publicPath at build time, so
        # a scheme-less value must be normalized/rejected before the image build.
        steps = self.doc["jobs"]["build-and-push"]["steps"]
        names = [s.get("name", "") for s in steps]
        self.assertIn("Resolve and validate frontend build URLs", names)
        build_steps = [s for s in steps if s.get("uses", "").startswith("docker/build-push-action")]
        build_args = build_steps[1]["with"]["build-args"]
        self.assertIn("APP_BASE_URL=${{ env.CANONICAL_PUBLIC_URL }}", build_args)
        self.assertIn("BACKEND_BASE_URL=${{ env.CANONICAL_PUBLIC_URL }}", build_args)
        self.assertNotIn("BUILD_APP_BASE_URL", build_args)

    def test_build_defines_frontend_webapp_name(self):
        # Used by workflow metadata and deployment summaries.
        env = self.doc["env"]
        self.assertEqual(env.get("FRONTEND_WEBAPP_NAME"), "cloudhub-frontend")

    def test_build_default_url_is_canonical_and_non_azure(self):
        resolve = next(
            step
            for step in self.doc["jobs"]["build-and-push"]["steps"]
            if step.get("name") == "Resolve and validate frontend build URLs"
        )
        env = resolve.get("env", {})
        self.assertIn("cannot use an azurewebsites.net hostname", resolve.get("run", ""))
        self.assertEqual(env.get("BUILD_APP_BASE_URL"), "${{ env.CANONICAL_PUBLIC_URL }}")
        self.assertEqual(self.doc["env"].get("CANONICAL_PUBLIC_URL"), "https://cloudhub.symphonyai.cloud")

    def test_backend_dockerfile_strategy_guard_present(self):
        steps = self.doc["jobs"]["build-and-push"]["steps"]
        guard = next((s for s in steps if s.get("name") == "Verify backend Dockerfile install strategy"), None)
        self.assertIsNotNone(guard)
        script = guard.get("run", "")
        self.assertIn("yarn install --immutable --mode=skip-build", script)
        self.assertIn("yarn workspaces focus --all --production", script)


class TestDockerComposeIngress(unittest.TestCase):
    compose = REPO_ROOT / "docker-compose.yml"

    def setUp(self):
        self.doc = load(self.compose)

    def test_frontend_is_first_service(self):
        services = list(self.doc["services"].keys())
        self.assertGreaterEqual(len(services), 1)
        self.assertEqual(
            services[0],
            "frontend",
            "frontend must be the first service so Azure App Service routes public traffic to it",
        )

    def test_frontend_proxies_to_backend_service(self):
        frontend = self.doc["services"]["frontend"]
        env = frontend.get("environment", {})
        self.assertEqual(env.get("BACKEND_ORIGIN"), "http://backend:7007")
        self.assertIn("ports", frontend)
        self.assertIn("0.0.0.0:3000:80", frontend["ports"])


class TestDeployAksNamespaceWorkflow(unittest.TestCase):
    wf = REPO_ROOT / ".github" / "workflows" / "deploy-aks-namespace.yml"

    def setUp(self):
        self.doc = load(self.wf)

    def test_backend_dockerfile_strategy_guard_present(self):
        steps = self.doc["jobs"]["build-and-push"]["steps"]
        guard = next((s for s in steps if s.get("name") == "Verify backend Dockerfile install strategy"), None)
        self.assertIsNotNone(guard)
        self.assertEqual(guard.get("if"), "${{ steps.meta.outputs.skip_build != 'true' }}")
        script = guard.get("run", "")
        self.assertIn("yarn install --immutable --mode=skip-build", script)
        self.assertIn("yarn workspaces focus --all --production", script)


class TestDeployAppServiceBackendWorkflow(unittest.TestCase):
    wf = REPO_ROOT / ".github" / "workflows" / "deploy-fe-be-prod-basic.yml"

    def setUp(self):
        self.doc = load(self.wf)

    def test_manual_trigger_inputs(self):
        on = self.doc.get(True) or self.doc.get("on")
        self.assertIn("workflow_dispatch", on)
        self.assertIn("workflow_call", on)

        dispatch_inputs = on["workflow_dispatch"]["inputs"]
        call_inputs = on["workflow_call"]["inputs"]

        for key in (
            "image_version",
            "frontend_image",
            "backend_image",
            "image_tag",
            "frontend_tag",
            "backend_tag",
            "configure_backend_app_settings",
            "backend_startup_command",
        ):
            self.assertIn(key, dispatch_inputs)
            self.assertIn(key, call_inputs)

        self.assertNotIn("resource_group", dispatch_inputs)
        self.assertNotIn("webapp_name", dispatch_inputs)

    def test_required_secret_envs_present(self):
        env = self.doc["env"]
        for key in (
            "REGISTRY",
            "ACR_NAME",
            "RESOURCE_GROUP",
            "BACKEND_WEBAPP_NAME",
        ):
            self.assertIn(key, env)

    def test_static_deploy_target_present(self):
        env = self.doc["env"]
        self.assertEqual(env.get("RESOURCE_GROUP"), "rg-cfe-apps-mj")
        self.assertEqual(env.get("BACKEND_WEBAPP_NAME"), "cloudhub-backend")
        self.assertEqual(env.get("CANONICAL_PUBLIC_URL"), "https://cloudhub.symphonyai.cloud")

    def test_backend_url_inputs_use_canonical_public_url(self):
        step = next(
            step
            for step in self.doc["jobs"]["deploy-backend"]["steps"]
            if step.get("name") == "Configure backend app settings (Azure PostgreSQL + Microsoft auth)"
        )
        self.assertEqual(step["env"].get("APP_BASE_URL"), "${{ env.CANONICAL_PUBLIC_URL }}")
        self.assertEqual(step["env"].get("BACKEND_BASE_URL"), "${{ env.CANONICAL_PUBLIC_URL }}")

    def test_uses_azure_login_and_container_set(self):
        steps = self.doc["jobs"]["deploy-backend"]["steps"]
        uses = " ".join(s.get("uses", "") for s in steps)
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("actions/checkout@v5", uses)
        self.assertIn("az login", runs)
        self.assertIn("az webapp config container set", runs)
        self.assertIn("az webapp config appsettings set", runs)
        self.assertIn("Sensitive value source check passed", runs)

    def test_validate_public_url_rejects_scheme_less(self):
        steps = self.doc["jobs"]["deploy-backend"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("must be an absolute URL including the https:// scheme", runs)

    def test_default_health_urls_use_canonical_hostname(self):
        on = self.doc.get(True) or self.doc.get("on")
        dispatch = on["workflow_dispatch"]["inputs"]
        call = on["workflow_call"]["inputs"]
        self.assertEqual(
            dispatch["backend_health_url"]["default"],
            "https://cloudhub.symphonyai.cloud/.backstage/health/v1/readiness",
        )
        self.assertEqual(
            dispatch["frontend_health_url"]["default"],
            "https://cloudhub.symphonyai.cloud/",
        )
        self.assertEqual(
            call["backend_health_url"]["default"],
            "https://cloudhub.symphonyai.cloud/.backstage/health/v1/readiness",
        )
        self.assertEqual(
            call["frontend_health_url"]["default"],
            "https://cloudhub.symphonyai.cloud/",
        )

    def test_backend_url_resolution_avoids_appservice_hostname_fallback(self):
        steps = self.doc["jobs"]["deploy-backend"]["steps"]
        configure = next(
            step
            for step in steps
            if step.get("name") == "Configure backend app settings (Azure PostgreSQL + Microsoft auth)"
        )
        run = configure.get("run", "")
        self.assertIn('resolved_backend_base_url="${BACKEND_BASE_URL:-$APP_BASE_URL}"', run)
        self.assertNotIn('resolved_backend_base_url="https://${backend_host}"', run)
        self.assertIn('APP_CONFIG_backend_baseUrl="$APP_BASE_URL"', run)
        self.assertIn("cannot use an azurewebsites.net hostname in production", run)

    def test_frontend_health_verifies_static_asset(self):
        # index.html returns 200 even when the bundle's /static assets 404, so the
        # health check must fetch a referenced asset to catch a broken publicPath.
        steps = self.doc["jobs"]["deploy-frontend"]["steps"]
        names = [s.get("name", "") for s in steps]
        self.assertIn("Verify frontend health", names)
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("/static", runs)
        self.assertIn("static asset", runs)


class TestReleaseProductionWorkflow(unittest.TestCase):
    wf = REPO_ROOT / ".github" / "workflows" / "release-production.yml"

    def setUp(self):
        self.doc = load(self.wf)
        self.deploy_doc = load(REPO_ROOT / ".github" / "workflows" / "deploy-fe-be-prod-basic.yml")
        self.build_doc = load(REPO_ROOT / ".github" / "workflows" / "build-fe-be-prod-basic.yml")

    def test_manual_trigger_inputs(self):
        on = self.doc.get(True) or self.doc.get("on")
        self.assertEqual(set(on.keys()), {"workflow_dispatch"})
        inputs = on["workflow_dispatch"]["inputs"]
        self.assertIn("version_prefix", inputs)
        self.assertIn("release_channel", inputs)
        self.assertIn("backend_health_url", inputs)
        self.assertIn("strict_auth_smoke_check", inputs)
        self.assertIn("run_db_migrations", inputs)
        self.assertNotIn("resource_group", inputs)
        self.assertNotIn("backend_webapp_name", inputs)
        self.assertNotIn("frontend_webapp_name", inputs)

    def test_default_health_urls_use_canonical_hostname(self):
        on = self.doc.get(True) or self.doc.get("on")
        inputs = on["workflow_dispatch"]["inputs"]
        self.assertEqual(
            inputs["backend_health_url"]["default"],
            "https://cloudhub.symphonyai.cloud/.backstage/health/v1/readiness",
        )
        self.assertEqual(
            inputs["frontend_health_url"]["default"],
            "https://cloudhub.symphonyai.cloud/",
        )

    def test_static_production_targets_present(self):
        env = self.deploy_doc["env"]
        self.assertEqual(env.get("RESOURCE_GROUP"), "rg-cfe-apps-mj")
        self.assertEqual(env.get("BACKEND_WEBAPP_NAME"), "cloudhub-backend")
        self.assertEqual(env.get("FRONTEND_WEBAPP_NAME"), "cloudhub-frontend")

    def test_required_job_sequence(self):
        jobs = self.doc["jobs"]
        self.assertIn("quality-gates", jobs)
        self.assertIn("resolve-version", jobs)
        self.assertIn("build-images", jobs)
        self.assertIn("db-migrations", jobs)
        self.assertIn("deploy-appservice", jobs)

        self.assertEqual(jobs["resolve-version"]["needs"], "quality-gates")
        self.assertEqual(jobs["build-images"]["needs"], "resolve-version")
        self.assertEqual(jobs["db-migrations"]["needs"], "quality-gates")

        # Deploy must not start before images are built and migrations have run.
        # Asserted as a superset so adding a further gate (for example
        # validate-provisioning-credentials) does not break this test.
        self.assertLessEqual(
            {"build-images", "db-migrations"},
            set(jobs["deploy-appservice"]["needs"]),
        )

    def test_backend_health_verification_present(self):
        steps = self.deploy_doc["jobs"]["deploy-backend"]["steps"]
        names = [s.get("name", "") for s in steps]
        self.assertIn("Verify backend health", names)
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("curl", runs)
        self.assertIn("Backend health check did not return an acceptable HTTP status", runs)
        self.assertIn("sleep", runs)

    def test_release_has_preflight_secret_validation(self):
        steps = self.deploy_doc["jobs"]["deploy-backend"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("Missing required value", runs)
        self.assertIn("Sensitive value source check passed", runs)

    def test_release_has_postgres_connectivity_preflight(self):
        steps = self.deploy_doc["jobs"]["deploy-backend"]["steps"]
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("postgresql-client", runs)
        self.assertIn("psql", runs)
        self.assertIn("select 1", runs)
        self.assertIn("PostgreSQL connectivity preflight failed", runs)

    def test_no_legacy_database_host_default(self):
        # Legacy PostgreSQL hostnames must not leak into cloudhub backend
        # defaults; the cloudhub database host is the only acceptable default.
        text = read(self.wf)
        self.assertNotIn("legacy-prod-pg", text)
        self.assertIn("cloudhub-pg-sdc.postgres.database.azure.com", text)

    def test_pgsslmode_bound_wherever_used(self):
        # PGSSLMODE is consumed under `set -u`; any step referencing it must also
        # define it in env, otherwise the step fails with an unbound variable.
        for step in self.deploy_doc["jobs"]["deploy-backend"]["steps"]:
            run = step.get("run", "")
            if "PGSSLMODE" in run:
                self.assertIn("PGSSLMODE", step.get("env", {}) or {})

    def test_frontend_health_verifies_static_asset(self):
        steps = self.deploy_doc["jobs"]["deploy-frontend"]["steps"]
        names = [s.get("name", "") for s in steps]
        self.assertIn("Verify frontend health", names)
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("/static", runs)
        self.assertIn("static asset", runs)

    def test_release_has_microsoft_auth_smoke_check(self):
        steps = self.deploy_doc["jobs"]["deploy-backend"]["steps"]
        names = [s.get("name", "") for s in steps]
        self.assertIn("Verify Microsoft auth smoke", names)
        runs = " ".join(s.get("run", "") for s in steps)
        self.assertIn("/api/auth/microsoft/start", runs)
        self.assertIn("AADSTS500113", runs)
        self.assertIn("redirect_uri=", runs)

    def test_frontend_build_urls_validated_before_bake(self):
        # The release must reuse the one build workflow that bakes APP_BASE_URL /
        # BACKEND_BASE_URL into the bundle; a build path missing those build-args
        # ships a frontend pinned to the Dockerfile's localhost defaults.
        jobs = self.doc["jobs"]
        self.assertIn("build-images", jobs)
        self.assertEqual(
            jobs["build-images"]["uses"],
            "./.github/workflows/build-fe-be-prod-basic.yml",
        )

        frontend_step = next(
            step
            for step in self.build_doc["jobs"]["build-and-push"]["steps"]
            if step.get("name") == "Build and push frontend image"
        )
        build_args = frontend_step["with"]["build-args"]
        self.assertIn("APP_BASE_URL=", build_args)
        self.assertIn("BACKEND_BASE_URL=", build_args)

    def test_frontend_bundle_is_built_single_origin(self):
        # backend.baseUrl must equal the frontend's own origin: nginx proxies
        # /api/, and a split origin loses the OAuth nonce cookie on callback.
        steps = self.build_doc["jobs"]["build-and-push"]["steps"]
        resolve = next(
            step
            for step in steps
            if step.get("name") == "Resolve and validate frontend build URLs"
        )
        self.assertNotIn("BUILD_BACKEND_BASE_URL", resolve.get("env", {}) or {})
        self.assertIn(
            'normalize_and_validate BACKEND_BASE_URL "$BUILD_APP_BASE_URL"',
            resolve["run"],
        )


class TestComponentDeployWorkflows(unittest.TestCase):
    deploy_wf = REPO_ROOT / ".github" / "workflows" / "deploy-fe-be-prod-basic.yml"
    component_wf = REPO_ROOT / ".github" / "workflows" / "deploy-component-prod.yml"

    def setUp(self):
        self.deploy_doc = load(self.deploy_wf)
        self.component_doc = load(self.component_wf)

    def test_deploy_component_input_exposed_on_both_triggers(self):
        on = self.deploy_doc.get(True) or self.deploy_doc.get("on")
        dispatch = on["workflow_dispatch"]["inputs"]["deploy_component"]
        self.assertEqual(dispatch["default"], "both")
        self.assertEqual(dispatch["options"], ["both", "frontend", "backend"])
        self.assertEqual(on["workflow_call"]["inputs"]["deploy_component"]["default"], "both")

    def test_deploy_jobs_are_gated_by_component(self):
        jobs = self.deploy_doc["jobs"]
        self.assertIn(
            "needs.resolve-image-tags.outputs.deploy_backend == '1'",
            jobs["deploy-backend"]["if"],
        )
        self.assertIn(
            "needs.resolve-image-tags.outputs.deploy_frontend == '1'",
            jobs["deploy-frontend"]["if"],
        )
        # Frontend must still run when the backend job was skipped by selection.
        self.assertIn("needs.deploy-backend.result == 'skipped'", jobs["deploy-frontend"]["if"])

    def test_component_workflow_delegates_to_deploy_workflow(self):
        job = self.component_doc["jobs"]["deploy"]
        self.assertEqual(job["uses"], "./.github/workflows/deploy-fe-be-prod-basic.yml")
        self.assertEqual(job["with"]["deploy_component"], "${{ inputs.component }}")

        on = self.component_doc.get(True) or self.component_doc.get("on")
        options = on["workflow_dispatch"]["inputs"]["component"]["options"]
        self.assertEqual(options, ["frontend", "backend"])

    def test_component_defaults_use_canonical_hostname(self):
        on = self.component_doc.get(True) or self.component_doc.get("on")
        inputs = on["workflow_dispatch"]["inputs"]
        self.assertEqual(
            inputs["backend_health_url"]["default"],
            "https://cloudhub.symphonyai.cloud/.backstage/health/v1/readiness",
        )
        self.assertEqual(
            inputs["frontend_health_url"]["default"],
            "https://cloudhub.symphonyai.cloud/",
        )


class TestFrontendDockerfile(unittest.TestCase):
    dockerfile = REPO_ROOT / "docker" / "Dockerfile.frontend"

    def test_normalizes_scheme_less_base_url(self):
        # A scheme-less app.baseUrl breaks the static-asset publicPath, so the
        # build prepends https:// and fails on an empty value before bundling.
        text = read(self.dockerfile)
        self.assertIn('value="https://${value}"', text)
        self.assertIn("APP_BASE_URL", text)
        self.assertIn("BACKEND_BASE_URL", text)

    def test_version_is_baked_into_image(self):
        # The version must travel with the image, otherwise a deploy made
        # outside the workflow (App Service Deployment Center) keeps reporting
        # whatever the CLOUDHUB_VERSION app setting was last set to.
        text = read(self.dockerfile)
        self.assertIn("ARG CLOUDHUB_VERSION=dev", text)
        self.assertIn("ENV CLOUDHUB_VERSION=${CLOUDHUB_VERSION}", text)


class TestDeployedVersionIntegrity(unittest.TestCase):
    build_wf = REPO_ROOT / ".github" / "workflows" / "build-fe-be-prod-basic.yml"
    deploy_wf = REPO_ROOT / ".github" / "workflows" / "deploy-fe-be-prod-basic.yml"

    def setUp(self):
        self.build_doc = load(self.build_wf)
        self.deploy_doc = load(self.deploy_wf)

    def test_build_bakes_tag_as_version(self):
        step = next(
            s
            for s in self.build_doc["jobs"]["build-and-push"]["steps"]
            if s.get("name") == "Build and push frontend image"
        )
        self.assertIn(
            "CLOUDHUB_VERSION=${{ steps.tags.outputs.frontend_tag }}",
            step["with"]["build-args"],
        )

    def test_deploy_does_not_set_frontend_version_app_setting(self):
        # A CLOUDHUB_VERSION app setting overrides the image-baked value at
        # nginx envsubst time and is the drift vector this guards against.
        step = next(
            s
            for s in self.deploy_doc["jobs"]["deploy-frontend"]["steps"]
            if s.get("name") == "Deploy frontend container image"
        )
        run = step["run"]
        self.assertNotIn('CLOUDHUB_VERSION="', run)
        self.assertIn("appsettings delete", run)
        self.assertIn("--setting-names CLOUDHUB_VERSION", run)

    def test_deploy_asserts_running_image_matches_intent(self):
        for job, step_name, app in (
            ("deploy-backend", "Verify backend runs the intended version", "BACKEND_WEBAPP_NAME"),
            ("deploy-frontend", "Verify frontend runs the intended version", "FRONTEND_WEBAPP_NAME"),
        ):
            steps = self.deploy_doc["jobs"][job]["steps"]
            step = next(s for s in steps if s.get("name") == step_name)
            run = step["run"]
            self.assertIn("linuxFxVersion", run)
            self.assertIn(app, run)
            self.assertIn("but this deploy targeted", run)

    def test_frontend_verifies_served_version_matches_tag(self):
        steps = self.deploy_doc["jobs"]["deploy-frontend"]["steps"]
        step = next(
            s for s in steps if s.get("name") == "Verify frontend runs the intended version"
        )
        self.assertIn("/__cloudhub_version", step["run"])
        self.assertIn("EXPECTED_TAG", step["env"])

    def test_version_check_runs_before_rollback(self):
        # The rollback step is `if: failure()`, so the version assertion only
        # protects the deploy if it is declared ahead of it.
        names = [s.get("name") for s in self.deploy_doc["jobs"]["deploy-frontend"]["steps"]]
        self.assertLess(
            names.index("Verify frontend runs the intended version"),
            names.index("Roll back frontend on failure"),
        )

    def test_easy_auth_disabled_without_az_extension(self):
        # `az webapp auth update` hits the legacy v1 auth API unless the authV2
        # extension is installed; ARM rejects that on a v2 site with
        # "the site is running on auth version v2", which fails the deploy.
        text = read(self.deploy_wf)
        self.assertNotIn("az webapp auth update", text.replace("`az webapp auth update`", ""))
        self.assertIn("config/authsettingsV2", text)
        self.assertIn("--set properties.platform.enabled=false", text)


if __name__ == "__main__":
    unittest.main()
