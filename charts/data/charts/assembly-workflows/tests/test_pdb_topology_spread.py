"""Guard the topologySpreadConstraints on PDB-protected multi-replica deployments.

Every Deployment that gets a PodDisruptionBudget in pdb.yaml when replicas>1
needs a topologySpreadConstraints (or podAntiAffinity) block so its replicas
don't co-locate on a single node -- without it, draining that one node needs
to evict all co-located replicas at once, which the PDB correctly refuses
forever (node-pool scale-down/delete/terraform destroy then stalls for the
full operation timeout, see #1382). This test fails if a future edit drops
the spread constraint from any of the deployments below.
"""

import pathlib
import re

TEMPLATES = pathlib.Path(__file__).resolve().parents[1] / "templates"

# Deployments with a PDB gated on replicas > 1 in pdb.yaml, mapped to their
# app label. assembly-core/engine-worker/code-worker/sandbox-execute already
# had spread constraints before #1382; apisix/frontend/sandbox-trigger/
# assembly-engine did not and were added by #1382. assembly-llm-gateway
# (missing both a PDB and this spread constraint) and
# assembly-engine-subflow-worker (had the spread constraint but no PDB) were
# both closed by #1584.
PDB_PROTECTED = {
    "apisix.yaml": "assembly-apisix",
    "frontend.yaml": "assembly-frontend",
    "assembly-core.yaml": "assembly-core",
    "assembly-engine.yaml": "assembly-engine",
    "assembly-engine-worker.yaml": "assembly-engine-worker",
    "assembly-engine-code-worker.yaml": "assembly-engine-code-worker",
    "assembly-sandbox-trigger.yaml": "assembly-sandbox-trigger",
    "assembly-sandbox-execute.yaml": "assembly-sandbox-execute",
    "assembly-llm-gateway.yaml": "assembly-llm-gateway",
    "assembly-engine-subflow-worker.yaml": "assembly-engine-subflow-worker",
}


def _has_spread_or_anti_affinity(text: str, app_label: str) -> bool:
    if re.search(r"^\s*topologySpreadConstraints:\s*$", text, re.MULTILINE):
        # Confirm it's scoped to this deployment's own pods, not a stray
        # unrelated selector further down the file.
        return f"app: {app_label}" in text
    if re.search(r"^\s*podAntiAffinity:\s*$", text, re.MULTILINE):
        return f"app: {app_label}" in text
    return False


def test_pdb_protected_deployments_have_spread_constraint():
    for filename, app_label in PDB_PROTECTED.items():
        path = TEMPLATES / filename
        assert path.exists(), f"expected template {filename} not found"
        text = path.read_text()
        assert _has_spread_or_anti_affinity(text, app_label), (
            f"{filename}: PDB-protected deployment must have "
            f"topologySpreadConstraints or podAntiAffinity keyed to "
            f"'app: {app_label}', or a node drain can stall forever on its "
            f"PDB when replicas co-locate (see #1382)"
        )
