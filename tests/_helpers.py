"""Shared test utilities."""
from __future__ import annotations

import os
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

CHARTS_DIR = REPO_ROOT / "cloudhub-platform-helm-charts" / "charts"
BACKSTAGE_TEMPLATES_DIR = REPO_ROOT / "cloudhub-backstage-templates" / "templates"
LIVE_INFRA_DIR = REPO_ROOT / "cloudhub-live-infra"
AKS_ROOT = LIVE_INFRA_DIR / "azure-kubernetes-service"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


# Strip Backstage scaffolder placeholders so YAML parses as YAML.
# Replaces "${{ ... }}" with a unique placeholder string.
SCAFFOLDER_EXPR = re.compile(r"\$\{\{[^}]*\}\}")


def neutralize_scaffolder_placeholders(text: str) -> str:
    return SCAFFOLDER_EXPR.sub("__PLACEHOLDER__", text)


# Find all parameter references in a Backstage template.
PARAM_REF = re.compile(r"\$\{\{\s*parameters\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
STEP_OUTPUT_REF = re.compile(r"\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_]*)\.output")


def find_param_refs(text: str) -> set[str]:
    return set(PARAM_REF.findall(text))
