#!/bin/bash
set -euo pipefail

if [[ $# -gt 1 ]] || [[ $# -eq 1 && "$1" != "--push" ]]; then
  echo "usage: scripts/tag-release.sh [--push]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "error: release tags must be created from main" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean" >&2
  exit 1
fi

git fetch --prune origin main --tags
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "error: local main must exactly match origin/main" >&2
  exit 1
fi

VERSION="$(node scripts/release-version.mjs)"
TAG="v$VERSION"
if git show-ref --verify --quiet "refs/tags/$TAG"; then
  echo "error: local tag $TAG already exists" >&2
  exit 1
fi
set +e
REMOTE_TAG_RESULT="$(git ls-remote --exit-code --tags origin "refs/tags/$TAG" 2>&1)"
REMOTE_TAG_STATUS=$?
set -e
if [[ $REMOTE_TAG_STATUS -eq 0 ]]; then
  echo "error: remote tag $TAG already exists" >&2
  exit 1
fi
if [[ $REMOTE_TAG_STATUS -ne 2 ]]; then
  echo "error: remote tag check failed: $REMOTE_TAG_RESULT" >&2
  exit 1
fi

git tag -a "$TAG" -m "$TAG"
echo "Created annotated tag $TAG at $(git rev-parse --short HEAD)."
if [[ $# -eq 1 ]]; then
  git push origin "refs/tags/$TAG"
  echo "Pushed $TAG. The gated release workflow will validate it before any publication."
else
  echo "Push with: git push origin refs/tags/$TAG"
fi
