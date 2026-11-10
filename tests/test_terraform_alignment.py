"""Tests for Terraform variable / tfvars / module call alignment.

These tests are HCL-aware via regex (no `terraform` binary required). They
validate the contract between:
  - variables.tf      (declared inputs)
  - main.tf           (which inputs are wired into the module)
  - values/*.tfvars   (which inputs are populated)
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from tests._helpers import AKS_ROOT, read

VARIABLE_DECL = re.compile(r'^\s*variable\s+"([^"]+)"\s*\{', re.MULTILINE)

# A tfvars assignment is `name = ...` at the start of a line (allowing leading whitespace)
TFVARS_ASSIGN = re.compile(r'^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=', re.MULTILINE)

# In main.tf inside `module "x" { ... }`, inputs are `name = ...`. We capture
# all `name = var.X` (the wiring) but also `name = local.X` and other refs.
MODULE_INPUT_LINE = re.compile(
    r'^\s*([a-z_][a-z0-9_]*)\s*=\s*(.+?)\s*$', re.MULTILINE
)


def declared_variables() -> set[str]:
    return set(VARIABLE_DECL.findall(read(AKS_ROOT / "variables.tf")))


def tfvars_keys(path: Path) -> set[str]:
    text = read(path)
    # Strip nested-block keys (only top-level assignments count).
    # Top-level lines have no leading whitespace.
    keys = set()
    depth = 0
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # Count braces to track top-level assignments only.
        opens = stripped.count("{") + stripped.count("[")
        closes = stripped.count("}") + stripped.count("]")
        if depth == 0:
            m = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)\s*=', line)
            if m:
                keys.add(m.group(1))
        depth += opens - closes
        if depth < 0:
            depth = 0
    return keys


class TestVariablesDeclared(unittest.TestCase):
    def test_required_variables_present(self):
        declared = declared_variables()
        # The module-call wiring lives in main.tf; we only assert a few must-haves.
        for v in [
            "env",
            "region_code",
            "tenancy",
            "tenant_id",
            "location",
            "create_resource_group",
            "resource_group_name",
            "create_vnet",
            "address_space",
            "subnet_address_prefixes",
            "dns_prefix",
            "kubernetes_version",
            "service_cidr",
            "dns_service_ip",
            "identity_ids",
            "default_node_pool",
            "tags",
        ]:
            self.assertIn(v, declared, f"variables.tf must declare '{v}'")


class TestTfvarsAlignment(unittest.TestCase):
    """Every key in seed tfvars must be a declared variable."""

    def test_seed_tfvars_keys_declared(self):
        declared = declared_variables()
        seed = AKS_ROOT / "values" / "aks-cloudhub-dev-cnc-st-scotia.tfvars"
        keys = tfvars_keys(seed)
        unknown = keys - declared
        self.assertFalse(
            unknown,
            f"tfvars uses undeclared variables: {sorted(unknown)}",
        )


class TestMainTfWiring(unittest.TestCase):
    """Every var.X reference in main.tf must be a declared variable."""

    def test_var_refs_resolve(self):
        declared = declared_variables()
        text = read(AKS_ROOT / "main.tf")
        used = set(re.findall(r"\bvar\.([a-zA-Z_][a-zA-Z0-9_]*)", text))
        unknown = used - declared
        self.assertFalse(
            unknown, f"main.tf references undeclared vars: {sorted(unknown)}"
        )

    def test_module_call_present(self):
        text = read(AKS_ROOT / "main.tf")
        self.assertIn('module "aks"', text)
        self.assertIn("source", text)

    def test_resource_group_handled(self):
        text = read(AKS_ROOT / "main.tf")
        self.assertIn("azurerm_resource_group", text)

    def test_vnet_creation_optional(self):
        text = read(AKS_ROOT / "main.tf")
        self.assertIn("create_vnet", text)


class TestBackend(unittest.TestCase):
    def test_tfc_cloud_block_present(self):
        text = read(AKS_ROOT / "backend.tf")
        self.assertIn("cloud {", text)
        self.assertIn("organization", text)


class TestSkeletonRendersFromDeclaredVars(unittest.TestCase):
    """The Backstage skeleton tfvars must only emit declared variables."""

    skeleton = (
        Path(__file__).resolve().parent.parent
        / "cloudhub-backstage-templates"
        / "templates"
        / "create-aks-cluster"
        / "skeleton"
        / "values"
    )

    def test_skeleton_only_declares_known_vars(self):
        # Skeleton filename includes the placeholder ${{ values.clusterName }}.tfvars
        files = list(self.skeleton.iterdir())
        self.assertEqual(len(files), 1, "Expected exactly one skeleton tfvars file")
        text = read(files[0])
        # Strip Nunjucks expressions so the regex still matches `key = ...`.
        text_clean = re.sub(r"\$\{\{[^}]*\}\}", "PLACEHOLDER", text)
        keys = set(re.findall(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*=", text_clean, re.MULTILINE))
        # Drop nested-object keys that are not top-level (heuristic: indent).
        top_level = set()
        for line in text_clean.splitlines():
            m = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*=", line)
            if m:
                top_level.add(m.group(1))
        declared = declared_variables()
        unknown = top_level - declared
        self.assertFalse(
            unknown,
            f"Skeleton uses undeclared variables: {sorted(unknown)}",
        )


if __name__ == "__main__":
    unittest.main()
