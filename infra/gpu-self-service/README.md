# GPU self-service Terraform module

This module is the repo-local runtime source for CloudHub GPU provisioning.

It intentionally lives inside the platform repo so GPU creation does not depend on an external private GitHub repo at runtime.

The original company-standard references used by this implementation are:
- SymphonySensa/scp-infra-as-code
- SymphonySensa/scp-azure-terraform-modules

Those remain design references only. The runtime source of truth for CloudHub is this repo-local module path.
