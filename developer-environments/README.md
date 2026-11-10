# Developer Workspace Platform Assets

This directory contains Phase 2 assets for standardized SRI developer workspaces.

## Ownership Model

Platform Engineering owns:

- base and toolchain developer images
- image build, smoke test, and security scan pipeline
- approved workspace tooling and VS Code extension recommendations

Application teams own:

- repository source code and dependencies
- application runtime Dockerfile
- application-specific local debug/run conventions

## Directory Layout

- images/base: common developer tooling image
- images/node: Node.js workspace image
- images/python: Python workspace image
- images/java: Java workspace image
- images/scala: Scala/Spark workspace image
- images/postgres: PostgreSQL tooling workspace image
- templates/devcontainer: reusable devcontainer template
- tests/images: image smoke tests

## Security Guardrails

- No credentials are embedded in images.
- No kubeconfig or cloud access tokens are embedded.
- Containers run as non-root developer user by default.
- Images are versioned and scanned before publication.
