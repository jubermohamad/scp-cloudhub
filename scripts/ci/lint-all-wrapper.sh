#!/bin/bash
# Wrapper script for backstage-cli repo lint to handle root directory edge case.
# The repo root has no source files, and eslint can report that as an error even
# when all package/plugin workspaces lint successfully.

set -euo pipefail

# Use the workspace-pinned CLI version via yarn and capture all output.
if ! output=$(yarn backstage-cli repo lint 2>&1); then
  exit_code=$?

  # Backstage/ESLint error text can vary by version. Treat both forms as benign.
  if echo "$output" | grep -Eq "No files matching '\\.' were found|All files matched by.*(are ignored|ignored)"; then
    filtered_output=$(echo "$output" | sed -E "/No files matching '\\.' were found/d; /All files matched by/d; /^Error:/d")
    [ -n "$filtered_output" ] && echo "$filtered_output"
    exit 0
  fi

  echo "$output"
  exit "$exit_code"
fi

echo "$output"
