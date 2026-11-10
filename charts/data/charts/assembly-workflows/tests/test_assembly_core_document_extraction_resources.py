"""assembly-core must be sized, in memory and CPU, for in-process document
extraction (#1749).

``GET /api/v1/resources/{id}/content`` converts PDF/DOCX/XLSX with markitdown
inside the API process. The cost tracks the document's *content*, not its file
size, and it is large: measured in the assembly-core image, a 1.2 MB / 30k-row
XLSX peaks at ~784 MiB RSS, and importing markitdown alone costs ~115 MiB
permanently (magika's ONNX model).

Against the old 256Mi limit the cgroup SIGKILLed the pod part-way through
every conversion, so document reads 502'd and took all in-flight assembly-core
requests with them. Nothing caught it: Compose imposes no memory limit, so it
reproduces only where a limit exists — a cluster. These tests are that limit's
guard, asserting the rendered limits still clear the measured floors.

The CPU limit belongs to the same failure: extraction is single-threaded and
CPU-bound while EXTRACTION_TIMEOUT_SECONDS is wall clock, so a throttled replica
turns a document that converts fine into a 422 timeout.
"""

from __future__ import annotations

import importlib.util
import pathlib
import re
import shutil
import subprocess

import pytest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]
VALUES_DEV = CHART / "values-dev.yaml"
REPO = CHART.parents[1]
EXTRACTOR = REPO / "services/assembly-core/app/services/document_extractor.py"

#: Idle RSS of an assembly-core replica, before any extraction (measured).
IDLE_RSS_MIB = 180


def _extraction_budget_mib() -> int:
    """The per-extraction budget assembly-core itself declares.

    Read out of the service rather than restated here, so the chart cannot be
    sized against a number the app has since moved. Loaded straight from the
    file — importing ``app.services.document_extractor`` as a package would drag
    in assembly-core's dependencies, which this suite (pytest + pyyaml) does not
    install; the module itself imports nothing outside the stdlib at module
    scope, markitdown very much included, which is what makes this safe.

    The app half of the same contract is
    ``services/assembly-core/tests/test_document_extractor_budget.py``, which
    measures real extractions against this constant. Together: the app proves
    extraction fits the budget, and this proves the container is big enough for
    it.
    """
    spec = importlib.util.spec_from_file_location("_document_extractor", EXTRACTOR)
    assert spec and spec.loader, f"cannot load {EXTRACTOR}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return int(module.EXTRACTION_PEAK_RSS_BUDGET_MIB)


#: Peak RSS of one extraction, per assembly-core's own declaration.
EXTRACTION_PEAK_MIB = _extraction_budget_mib()

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="helm not installed")

_QUANTITY = re.compile(r"(\d+(?:\.\d+)?)\s*(Mi|Gi|M|G)?$")


def _to_mib(quantity: str) -> float:
    match = _QUANTITY.fullmatch(str(quantity).strip())
    assert match, f"unparseable memory quantity {quantity!r}"
    value, unit = float(match.group(1)), match.group(2)
    return {
        "Mi": value,
        "Gi": value * 1024,
        "M": value * 1000**2 / 1024**2,
        "G": value * 1000**3 / 1024**2,
        None: value / 1024**2,
    }[unit]


def _run_render(*extra_args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "helm",
            "template",
            "t",
            str(CHART),
            "--set",
            "validation.allowPlaceholders=true",
            *extra_args,
        ],
        capture_output=True,
        text=True,
    )


def _render(*extra_args: str) -> str:
    result = _run_render(*extra_args)
    assert result.returncode == 0, result.stderr
    return result.stdout


def _core_container(rendered: str) -> dict:
    for doc in yaml.safe_load_all(rendered):
        if not doc or doc.get("kind") != "Deployment":
            continue
        if doc["metadata"]["name"] != "assembly-core":
            continue
        containers = doc["spec"]["template"]["spec"]["containers"]
        for container in containers:
            if container["name"] == "assembly-core":
                return container
    raise AssertionError("assembly-core container not found in render")


def _extraction_concurrency(container: dict) -> int:
    for entry in container.get("env") or []:
        if entry.get("name") == "DOCUMENT_EXTRACTION_CONCURRENCY":
            return int(entry["value"])
    raise AssertionError(
        "assembly-core does not set DOCUMENT_EXTRACTION_CONCURRENCY — without it "
        "the app default (2) doubles the memory the limit must cover"
    )


def _to_millicores(quantity: str) -> float:
    text = str(quantity).strip()
    return float(text[:-1]) if text.endswith("m") else float(text) * 1000


def _assert_sized_for_extraction(container: dict, source: str) -> None:
    limit = _to_mib(container["resources"]["limits"]["memory"])
    concurrency = _extraction_concurrency(container)
    floor = IDLE_RSS_MIB + concurrency * EXTRACTION_PEAK_MIB
    assert limit >= floor, (
        f"{source}: assembly-core memory limit is {limit:.0f}Mi but document "
        f"extraction needs >= {floor}Mi (idle {IDLE_RSS_MIB}Mi + "
        f"{concurrency} x {EXTRACTION_PEAK_MIB}Mi). Below this the cgroup "
        "SIGKILLs the pod mid-conversion and every document read 502s."
    )


def _assert_cpu_allows_extraction(container: dict, source: str) -> None:
    """Extraction is single-threaded CPU-bound and its timeout is wall clock.

    Below a full core the pod is throttled hard enough that ordinary documents
    exceed EXTRACTION_TIMEOUT_SECONDS and 422 instead of converting — measured
    on assembly-aks-dev at 300m: 1167/1584 periods throttled, 18.4s for an 11 KB
    PDF.
    """
    cpu = _to_millicores(container["resources"]["limits"]["cpu"])
    assert cpu >= 1000, (
        f"{source}: assembly-core CPU limit is {cpu:.0f}m. Document extraction "
        "is single-threaded and CPU-bound with a wall-clock timeout; below one "
        "full core, throttling makes ordinary documents time out."
    )


def test_chart_defaults_size_core_for_document_extraction():
    container = _core_container(_render())
    _assert_sized_for_extraction(container, "chart defaults")
    _assert_cpu_allows_extraction(container, "chart defaults")


def test_dev_overlay_sizes_core_for_document_extraction():
    container = _core_container(_render("--values", str(VALUES_DEV)))
    _assert_sized_for_extraction(container, "values-dev.yaml")
    _assert_cpu_allows_extraction(container, "values-dev.yaml")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("two", "must be a whole number"),
        ("1.5", "must be a whole number"),
        ("0", "must be at least 1"),
        ("-1", "must be a whole number"),
    ],
)
def test_unusable_extraction_concurrency_fails_the_render(value, expected):
    """Caught at render, not at container start.

    The value reaches the app as a string and is parsed with int(): a typo
    raises at import and CrashLoopBackOffs the replica, and a 0 makes every
    document read wait out the slot timeout and fail. Neither is something an
    operator should learn from pod logs.
    """
    result = _run_render("--set", f"userProject.documentExtractionConcurrency={value}")

    assert result.returncode != 0, f"render accepted documentExtractionConcurrency={value}"
    assert expected in result.stderr, result.stderr


def test_raising_extraction_concurrency_requires_raising_the_limit():
    """The knob and the limit must move together, or the guard is decorative."""
    rendered = _render("--set", "userProject.documentExtractionConcurrency=4")
    with pytest.raises(AssertionError, match="document extraction needs"):
        _assert_sized_for_extraction(_core_container(rendered), "concurrency=4")
