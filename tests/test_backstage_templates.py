"""Tests for Backstage scaffolder templates."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml

from tests._helpers import (
    BACKSTAGE_TEMPLATES_DIR,
    PARAM_REF,
    find_param_refs,
    neutralize_scaffolder_placeholders,
    read,
)

CLUSTER_TEMPLATE = BACKSTAGE_TEMPLATES_DIR / "create-aks-cluster" / "template.yaml"


def parse(path: Path) -> dict:
    text = read(path)
    text = neutralize_scaffolder_placeholders(text)
    return yaml.safe_load(text)


def collect_param_names(template: dict) -> set[str]:
    names: set[str] = set()
    for page in template["spec"].get("parameters", []) or []:
        for prop in (page.get("properties") or {}).keys():
            names.add(prop)
    return names


class TestCreateAksClusterTemplate(unittest.TestCase):
    def setUp(self):
        self.raw = read(CLUSTER_TEMPLATE)
        self.tpl = parse(CLUSTER_TEMPLATE)

    def test_kind_and_name(self):
        self.assertEqual(self.tpl["kind"], "Template")
        self.assertEqual(self.tpl["metadata"]["name"], "create-aks-cluster")

    def test_review_confirm_page_present(self):
        page_titles = [p.get("title", "") for p in self.tpl["spec"]["parameters"]]
        self.assertIn("Review & Confirm", page_titles)

    def test_profile_and_capacity_pages_present(self):
        page_titles = [p.get("title", "") for p in self.tpl["spec"]["parameters"]]
        self.assertIn("Cluster profile", page_titles)
        self.assertIn("Capacity settings", page_titles)

    def test_cluster_profile_enum_values(self):
        profile_page = next(
            p for p in self.tpl["spec"]["parameters"] if p.get("title") == "Cluster profile"
        )
        profile = profile_page["properties"]["clusterProfile"]
        self.assertEqual(
            profile["enum"],
            ["free", "demo", "single-region", "active-passive", "active-active"],
        )

    def test_action_property_has_review_and_create(self):
        review_page = next(
            p for p in self.tpl["spec"]["parameters"] if p.get("title") == "Review & Confirm"
        )
        action = review_page["properties"]["action"]
        self.assertEqual(set(action["enum"]), {"review", "update", "cancel", "create"})

    def test_create_requires_confirmation(self):
        review_page = next(
            p for p in self.tpl["spec"]["parameters"] if p.get("title") == "Review & Confirm"
        )
        deps = review_page["dependencies"]["action"]["oneOf"]
        # The "create" branch must require confirmReviewed = true.
        create_branch = next(
            b for b in deps if b["properties"]["action"]["enum"] == ["create"]
        )
        self.assertEqual(
            create_branch["properties"]["confirmReviewed"]["const"], True
        )

    def test_step_ids_cover_lifecycle(self):
        step_ids = [s["id"] for s in self.tpl["spec"]["steps"]]
        # fetch (render) + pr (review/update/cancel surface) + plan (review) + apply (create)
        for required in ("fetch", "pr", "plan", "apply"):
            self.assertIn(required, step_ids, f"Missing lifecycle step '{required}'")

    def test_apply_step_is_conditional_on_create(self):
        apply_step = next(s for s in self.tpl["spec"]["steps"] if s["id"] == "apply")
        # Placeholder neutralized to __PLACEHOLDER__; ensure original raw has the guard.
        self.assertRegex(
            self.raw,
            r"if:\s*\$\{\{\s*parameters\.action\s*===\s*'create'\s*\}\}",
            "apply step must be guarded by parameters.action === 'create'",
        )

    def test_plan_step_dispatches_plan_workflow(self):
        plan = next(s for s in self.tpl["spec"]["steps"] if s["id"] == "plan")
        self.assertEqual(plan["action"], "github:actions:dispatch")
        self.assertEqual(plan["input"]["workflowId"], "plan-cluster.yaml")

    def test_apply_step_dispatches_apply_workflow(self):
        apply_step = next(s for s in self.tpl["spec"]["steps"] if s["id"] == "apply")
        self.assertEqual(apply_step["action"], "github:actions:dispatch")
        self.assertEqual(apply_step["input"]["workflowId"], "apply-cluster.yaml")

    def test_pr_step_targets_cloudhub_infra_as_code(self):
        pr = next(s for s in self.tpl["spec"]["steps"] if s["id"] == "pr")
        self.assertIn("cloudhub-infra-as-code", pr["input"]["repoUrl"])

    def test_all_param_refs_resolve(self):
        defined = collect_param_names(self.tpl)
        used = find_param_refs(self.raw)
        unknown = used - defined
        self.assertFalse(unknown, f"Template references undefined parameters: {sorted(unknown)}")

    def test_output_links_cover_review_update_cancel_create(self):
        # We expose Review (plan), Pull request (Update / Cancel), Create (apply), TFC workspace.
        link_titles = [l["title"] for l in self.tpl["spec"]["output"]["links"]]
        self.assertTrue(any("Review" in t for t in link_titles))
        self.assertTrue(any("Pull request" in t for t in link_titles))
        self.assertTrue(any("Create" in t for t in link_titles))


if __name__ == "__main__":
    unittest.main()
