"""Regression: multi-tenant overlays must not enable in-process custom_code.

``trustedCodeInprocess: true`` runs canvas ``custom_code`` via in-worker
``exec()``, which exposes worker secrets (FERNET_KEY, DATABASE_URL) to any
authenticated author — CRITICAL for external pentest / multi-tenant clusters.
"""
from __future__ import annotations

from pathlib import Path

import yaml

CHART = Path(__file__).resolve().parents[1]


def _load(name: str) -> dict:
    return yaml.safe_load((CHART / name).read_text())


def test_dev_overlay_disables_trusted_code_inprocess():
    assert _load("values-dev.yaml")["agentsCodeWorker"]["trustedCodeInprocess"] is False


def test_demo_overlay_disables_trusted_code_inprocess():
    assert _load("values-demo.yaml")["agentsCodeWorker"]["trustedCodeInprocess"] is False


def test_prod_perf_overlay_disables_trusted_code_inprocess():
    assert _load("values-prod-perf.yaml")["agentsCodeWorker"]["trustedCodeInprocess"] is False


def test_perf_tier_a_overlay_disables_trusted_code_inprocess():
    assert _load("values-perf-tierA.yaml")["agentsCodeWorker"]["trustedCodeInprocess"] is False


def test_chart_default_disables_trusted_code_inprocess():
    assert _load("values.yaml")["agentsCodeWorker"]["trustedCodeInprocess"] is False


def test_dev_overlay_requires_preview_access_token():
    extra = _load("values-dev.yaml").get("sandboxExecute", {}).get("extraEnv") or []
    by_name = {e["name"]: e.get("value") for e in extra if isinstance(e, dict)}
    assert by_name.get("PREVIEW_REQUIRE_ACCESS_TOKEN") == "true"


def test_demo_overlay_requires_preview_access_token():
    extra = _load("values-demo.yaml").get("sandboxExecute", {}).get("extraEnv") or []
    by_name = {e["name"]: e.get("value") for e in extra if isinstance(e, dict)}
    assert by_name.get("PREVIEW_REQUIRE_ACCESS_TOKEN") == "true"
