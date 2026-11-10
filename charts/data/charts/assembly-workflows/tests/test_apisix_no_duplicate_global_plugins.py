"""Static guard for #1551, a follow-up to #1547: two `global_rules` entries in
the same APISIX config configuring the same plugin do not compose the way a
naive reader would expect. APISIX's `response-rewrite` plugin gates its
ENTIRE behavior -- headers included -- on a single `vars` condition per
plugin instance (see apisix/plugins/response-rewrite.lua). PR #1534 added a
second `response-rewrite` global rule alongside the pre-existing
`sanitize-upstream-5xx` rule; the 5xx-only body substitution started firing
on EVERY response (including 2xx), with Content-Length left at the real
pre-rewrite length, hanging every client -- live on `main` until reverted by
PR #1550.

This is defense-in-depth: assert no plugin name appears in more than one
`global_rules` entry across each APISIX config file, so this exact bug class
can't silently reappear (e.g. when baseline security headers are
re-implemented some other way).
"""

import re
from pathlib import Path

import pytest
import yaml

_REPO_ROOT = Path(__file__).resolve().parents[3]

_CONFIGS = [
    _REPO_ROOT / "infra" / "apisix" / "apisix.yaml",
    _REPO_ROOT / "helm" / "assembly-workflows" / "files" / "apisix-routes.yaml",
    _REPO_ROOT / "k8s" / "overlays" / "modules" / "workflows" / "config" / "apisix-routes.yaml",
]

# Some of these files use APISIX's `vars: [[key, op, value], ...]` condition
# syntax elsewhere (e.g. in `routes`), which is valid APISIX config but is a
# list-used-as-a-dict-key pattern that breaks a naive whole-document
# `yaml.safe_load` (ConstructorError: unhashable key). Extract just the
# top-level `global_rules:` block by text and parse that fragment alone,
# rather than requiring the entire file to be parseable as one YAML document.
_GLOBAL_RULES_BLOCK = re.compile(
    r"^global_rules:\n((?:[ \t].*\n?|\n)*)", re.MULTILINE
)


def _load_global_rules(config_path: Path) -> list[dict]:
    text = config_path.read_text(encoding="utf-8")
    match = _GLOBAL_RULES_BLOCK.search(text)
    if not match:
        return []
    fragment = "global_rules:\n" + match.group(1)
    doc = yaml.safe_load(fragment)
    return (doc or {}).get("global_rules") or []


@pytest.mark.parametrize("config_path", _CONFIGS, ids=lambda p: p.name)
def test_no_plugin_used_by_more_than_one_global_rule(config_path: Path):
    assert config_path.exists(), f"missing APISIX config: {config_path}"
    global_rules = _load_global_rules(config_path)

    plugin_owners: dict[str, list[str]] = {}
    for rule in global_rules:
        rule_id = rule.get("id", "<unnamed>")
        for plugin_name in (rule.get("plugins") or {}):
            plugin_owners.setdefault(plugin_name, []).append(rule_id)

    duplicates = {
        plugin: owners for plugin, owners in plugin_owners.items() if len(owners) > 1
    }
    assert not duplicates, (
        f"{config_path.name}: plugin(s) configured by more than one global_rules "
        f"entry: {duplicates} -- APISIX plugins gate their entire behavior on a "
        f"single vars condition per instance, so multiple global_rules entries "
        f"configuring the same plugin do NOT compose (see #1547)."
    )
