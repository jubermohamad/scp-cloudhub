"""Guards against deep '/src/' or '/dist/' imports of @internal workspace packages.

A specifier like '@internal/plugin-platform-common/src/backend' resolves during
local development, because `yarn start` reads TypeScript straight from the
workspace. It does not resolve in a built container image: only the package's
`dist` directory is shipped, and its `main`/`exports` are rewritten to dist
paths at bundle time. The backend then exits 1 at startup with
MODULE_NOT_FOUND, which surfaces as an App Service 503.

`yarn tsc:full`, `yarn lint:all`, and `yarn test:all` all pass in that state --
the source really is on disk in the repo -- so this check is the gate.

To expose an additional entry point from an @internal package, declare it in
that package's `exports` and `typesVersions` (see plugins/platform-common) and
import the subpath without 'src'/'dist':
`@internal/plugin-platform-common/backend`.
"""
from __future__ import annotations

import re
import unittest

from tests._helpers import REPO_ROOT, read

SOURCE_ROOTS = ("packages", "plugins")
SOURCE_SUFFIXES = (".ts", ".tsx")

# Matches both `from '@internal/pkg/src/x'` and `require('@internal/pkg/dist/x')`.
DEEP_INTERNAL_IMPORT = re.compile(
    r"""['"](@internal/[^/'"]+/(?:src|dist)/[^'"]*)['"]"""
)


def iter_source_files():
    for root_name in SOURCE_ROOTS:
        root = REPO_ROOT / root_name
        if not root.is_dir():
            continue
        for workspace in sorted(root.iterdir()):
            src = workspace / "src"
            if not src.is_dir():
                continue
            for path in sorted(src.rglob("*")):
                if path.suffix in SOURCE_SUFFIXES and path.is_file():
                    yield path


class TestInternalPackageImports(unittest.TestCase):
    def test_no_deep_src_or_dist_imports(self):
        offenders = []
        for path in iter_source_files():
            for specifier in DEEP_INTERNAL_IMPORT.findall(read(path)):
                offenders.append(f"{path.relative_to(REPO_ROOT)}: {specifier}")

        self.assertEqual(
            [],
            offenders,
            "Deep '/src/' or '/dist/' imports of @internal packages break the "
            "built container image (MODULE_NOT_FOUND at startup). Declare a "
            "subpath entry point in the target package's `exports` and "
            "`typesVersions`, then import it without 'src'/'dist'. Offenders:\n"
            + "\n".join(offenders),
        )

    def test_guard_covers_the_backend_plugin_sources(self):
        # Sanity check: if the traversal silently found nothing, the assertion
        # above would pass vacuously and the regression could land again.
        files = {path.relative_to(REPO_ROOT).as_posix() for path in iter_source_files()}
        self.assertIn(
            "plugins/deployment-control-plane-backend/src/services/"
            "controlPlaneService.ts",
            files,
        )
        self.assertIn("packages/backend/src/index.ts", files)


if __name__ == "__main__":
    unittest.main()
