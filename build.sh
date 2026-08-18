#!/bin/bash
set -euo pipefail

BUMP="${1:-patch}"

if [ "$BUMP" = "none" ]; then
  NEW_VERSION=$(node -p "require('./package.json').version")
  echo "Using existing version v$NEW_VERSION"
else
  NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
  echo "Version bumped to $NEW_VERSION"
fi

pnpm build

pnpm dlx @vscode/vsce package --no-dependencies --allow-missing-repository
(
  cd theme-source
  pnpm dlx @vscode/vsce package --no-dependencies --allow-missing-repository
)
THEME_VERSION=$(node -p "require('./theme-source/package.json').version")
echo "Packaged: perwrite-${NEW_VERSION#v}.vsix and perwrite-theme-source-${THEME_VERSION}.vsix"
