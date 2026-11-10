"""Structural tests for the Helm charts."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml

from tests._helpers import CHARTS_DIR, read

REQUIRED_NS_TEMPLATES = {
    "namespace.yaml",
    "quota.yaml",
    "limitrange.yaml",
    "rolebinding.yaml",
    "networkpolicy.yaml",
    "serviceaccount.yaml",
    "_helpers.tpl",
}

REQUIRED_APP_TEMPLATES = {
    "deployment.yaml",
    "service.yaml",
    "ingress.yaml",
    "hpa.yaml",
    "configmap.yaml",
    "_helpers.tpl",
}

REQUIRED_NS_LABEL_KEYS = {
    "owner",
    "business-unit",
    "environment",
    "application",
    "cost-center",
}


class TestNamespaceBootstrapChart(unittest.TestCase):
    chart = CHARTS_DIR / "namespace-bootstrap"

    def test_chart_yaml_valid(self):
        meta = yaml.safe_load(read(self.chart / "Chart.yaml"))
        self.assertEqual(meta["name"], "namespace-bootstrap")
        self.assertEqual(meta["apiVersion"], "v2")
        self.assertIn("version", meta)

    def test_values_yaml_has_required_keys(self):
        v = yaml.safe_load(read(self.chart / "values.yaml"))
        for key in [
            "namespace",
            "owner",
            "businessUnit",
            "environment",
            "application",
            "costCenter",
            "resourceQuota",
            "limitRange",
            "networkPolicy",
            "serviceAccount",
            "rbac",
        ]:
            self.assertIn(key, v, f"values.yaml missing '{key}'")

    def test_default_deny_ingress_default_true(self):
        v = yaml.safe_load(read(self.chart / "values.yaml"))
        self.assertTrue(v["networkPolicy"]["defaultDenyIngress"])

    def test_required_templates_exist(self):
        present = {p.name for p in (self.chart / "templates").iterdir()}
        missing = REQUIRED_NS_TEMPLATES - present
        self.assertFalse(missing, f"Missing templates: {missing}")

    def test_helpers_define_required_labels(self):
        helpers = read(self.chart / "templates" / "_helpers.tpl")
        for key in REQUIRED_NS_LABEL_KEYS:
            self.assertIn(
                key + ":",
                helpers,
                f"_helpers.tpl labels block must include '{key}'",
            )

    def test_helpers_validate_required_string(self):
        helpers = read(self.chart / "templates" / "_helpers.tpl")
        self.assertIn("required", helpers.lower())
        self.assertIn("namespace-bootstrap.requiredString", helpers)

    def test_namespace_template_uses_helper(self):
        ns = read(self.chart / "templates" / "namespace.yaml")
        self.assertIn('include "namespace-bootstrap.namespace"', ns)
        self.assertIn('include "namespace-bootstrap.labels"', ns)

    def test_networkpolicy_default_deny(self):
        np = read(self.chart / "templates" / "networkpolicy.yaml")
        self.assertIn("default-deny-ingress", np)
        self.assertIn("policyTypes", np)
        self.assertIn("Ingress", np)

    def test_no_kubectl_imperative_create_namespace(self):
        # Charts must not use kubectl imperative; that is the whole point.
        for tpl in (self.chart / "templates").iterdir():
            self.assertNotIn("kubectl create namespace", read(tpl))


class TestAppBootstrapChart(unittest.TestCase):
    chart = CHARTS_DIR / "app-bootstrap"

    def test_chart_yaml_valid(self):
        meta = yaml.safe_load(read(self.chart / "Chart.yaml"))
        self.assertEqual(meta["name"], "app-bootstrap")
        self.assertEqual(meta["apiVersion"], "v2")

    def test_values_yaml_has_required_keys(self):
        v = yaml.safe_load(read(self.chart / "values.yaml"))
        for key in [
            "application",
            "namespace",
            "image",
            "replicas",
            "resources",
            "service",
            "ingress",
            "hpa",
        ]:
            self.assertIn(key, v)

    def test_required_templates_exist(self):
        present = {p.name for p in (self.chart / "templates").iterdir()}
        missing = REQUIRED_APP_TEMPLATES - present
        self.assertFalse(missing, f"Missing templates: {missing}")

    def test_deployment_uses_required_helpers(self):
        dep = read(self.chart / "templates" / "deployment.yaml")
        self.assertIn('include "app-bootstrap.name"', dep)
        self.assertIn('include "app-bootstrap.namespace"', dep)
        self.assertIn('include "app-bootstrap.labels"', dep)
        self.assertIn("resources:", dep)

    def test_ingress_requires_host_when_enabled(self):
        ing = read(self.chart / "templates" / "ingress.yaml")
        self.assertIn("ingress.host required when ingress enabled", ing)

    def test_hpa_template_targets_deployment(self):
        hpa = read(self.chart / "templates" / "hpa.yaml")
        self.assertIn("kind: HorizontalPodAutoscaler", hpa)
        self.assertIn("apiVersion: autoscaling/v2", hpa)
        self.assertIn("kind: Deployment", hpa)


class TestPlatformAddons(unittest.TestCase):
    chart = CHARTS_DIR / "platform-addons"

    def test_chart_yaml(self):
        meta = yaml.safe_load(read(self.chart / "Chart.yaml"))
        self.assertEqual(meta["name"], "platform-addons")


if __name__ == "__main__":
    unittest.main()
