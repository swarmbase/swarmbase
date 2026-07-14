#!/bin/bash
# Create the release tag for the version currently in the package.json files.
#
# The package.json version is the single source of truth: this script reads
# it, verifies every publishable workspace agrees, and creates the matching
# v<version> tag at HEAD. Because the tag is derived rather than typed, it
# cannot drift from the package versions. (The Release workflow re-checks the
# same invariant as a backstop.)
#
# Usage:
#   scripts/tag-release.sh          # create the tag locally
#   scripts/tag-release.sh --push   # create the tag and push it (publishes!)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean" >&2
  exit 1
fi

VERSION="$(node -p "require('./packages/collabswarm/package.json').version")"

MISMATCH=0
while read -r line; do
  location="$(echo "$line" | node -p "JSON.parse(require('fs').readFileSync(0)).location" 2>/dev/null || true)"
  [[ -z "$location" ]] && continue
  name="$(node -p "require('./$location/package.json').name")"
  version="$(node -p "require('./$location/package.json').version")"
  if [[ "$version" != "$VERSION" ]]; then
    echo "error: $name is at $version, expected $VERSION" >&2
    MISMATCH=1
  fi
done < <(yarn workspaces list --no-private --json)
[[ "$MISMATCH" -ne 0 ]] && exit 1

TAG="v$VERSION"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "error: tag $TAG already exists" >&2
  exit 1
fi

git tag -a "$TAG" -m "$TAG"
echo "Created tag $TAG at $(git rev-parse --short HEAD)."

if [[ "${1:-}" == "--push" ]]; then
  git push origin "$TAG"
  echo "Pushed $TAG — the Release workflow is publishing now."
else
  echo "Push it (this triggers the npm publish) with:"
  echo "  git push origin $TAG"
fi
