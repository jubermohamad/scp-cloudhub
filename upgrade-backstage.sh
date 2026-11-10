#!/bin/bash

# Exit immediately if any command fails
set -e

echo "🚀 Starting Backstage and Yarn upgrade pipeline..."

# 1. Update the core tool versions in package.json using node
echo "📝 Updating orchestrator versions in package.json..."
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

pkg.devDependencies["@backstage/cli"] = "^0.39.0";
pkg.devDependencies["@backstage/cli-defaults"] = "^0.1.3";
pkg.devDependencies["typescript"] = "~5.8.3";
pkg.packageManager = "yarn@4.18.1";

fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2), "utf8");
'

# 2. Upgrade the project's Yarn binary mapping
echo "📦 Upgrading Yarn binary to the latest stable release..."
yarn set version stable

# 3. Synchronize all sub-packages inside the monorepo workspaces
echo "🔄 Aligning internal Backstage dependency matrix..."
yarn backstage-cli versions:bump

# 4. Flush caches and link the dependency tree cleanly
echo "🧼 Flushing package caches and performing installation..."
yarn cache clean
yarn install

# 5. Typecheck the workspace to ensure everything fits perfectly
echo "🔎 Verifying TypeScript types across custom internal plugins..."
yarn tsc:full

# 6. Rebuild Docker containers bypassing cached layers
echo "🐳 Rebuilding Docker architecture layers cleanly..."
docker compose build --no-cache
docker compose up -d

echo "🎉 Upgrade successfully completed! Your platform is up to date."
