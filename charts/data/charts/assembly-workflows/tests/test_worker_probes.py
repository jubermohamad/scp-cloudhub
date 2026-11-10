"""Guard the engine-worker liveness-probe design.

The three engine-worker deployments (worker, code-worker, subflow-worker) run
the Temporal worker and the uvicorn app on ONE asyncio event loop. An httpGet
/health liveness probe reads a loop that is merely BUSY as "dead" and kubelet
kills a perfectly-alive worker, destroying its in-flight Temporal activities —
on tierA this collapsed throughput (C=400 fell below C=180 with a 107s p95) in
a kill→retry death spiral. Liveness for these pods MUST be a tcpSocket probe
(which the kernel answers regardless of loop load); dependency health belongs
in readiness. This test fails if anyone reverts a worker's liveness to httpGet.
"""

import pathlib
import re

TEMPLATES = pathlib.Path(__file__).resolve().parents[1] / "templates"
WORKER_TEMPLATES = [
    "assembly-engine-worker.yaml",
    "assembly-engine-code-worker.yaml",
    "assembly-engine-subflow-worker.yaml",
]


def _probe_block(text: str, probe: str) -> str:
    """The YAML lines from '<probe>:' up to the next key at the same
    indentation (the next probe / resources / etc.)."""
    m = re.search(rf"^(\s*){probe}:\s*$", text, re.MULTILINE)
    assert m, f"no {probe} found"
    indent = len(m.group(1))
    block = []
    for ln in text[m.end():].splitlines():
        if ln.strip() and (len(ln) - len(ln.lstrip())) <= indent:
            break
        block.append(ln)
    return "\n".join(block)


def test_worker_liveness_is_tcp_socket_not_httpget():
    for name in WORKER_TEMPLATES:
        block = _probe_block((TEMPLATES / name).read_text(), "livenessProbe")
        assert "tcpSocket:" in block, f"{name}: worker liveness must be tcpSocket"
        assert "httpGet:" not in block, (
            f"{name}: worker liveness must NOT be httpGet /health — a busy "
            f"event loop would be killed as dead (see module docstring)"
        )


def test_worker_readiness_is_httpget_health():
    # Readiness keeps the dependency-aware HTTP /health check (flapping is
    # harmless for a worker that polls Temporal and is not behind a Service).
    # Assert the readiness block actually uses httpGet with path: /health, not
    # merely that the substring "/health" appears somewhere nearby.
    for name in WORKER_TEMPLATES:
        block = _probe_block((TEMPLATES / name).read_text(), "readinessProbe")
        assert "httpGet:" in block, f"{name}: readiness must use httpGet"
        assert re.search(r"^\s*path:\s*/health\s*$", block, re.MULTILINE), (
            f"{name}: readiness httpGet path must be /health"
        )
        assert "tcpSocket:" not in block, (
            f"{name}: readiness should be the dependency-aware /health check, "
            f"not tcpSocket"
        )
