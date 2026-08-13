#!/usr/bin/env bash
# Snapshot the target repo's dependency manifests into container-context/ so
# the sandbox image build can pre-fetch the pnpm store (see Dockerfile).
# Run before building/deploying whenever the target repo's lockfile changed:
#
#   GITHUB_REPO=owner/repo ./scripts/prepare-container-context.sh
#
# Requires an authenticated `gh`. Skipping this (or a fetch failure) is safe —
# the image builds with a cold store and setup falls back to normal installs.
set -euo pipefail

repo="${GITHUB_REPO:-$(grep -E '^GITHUB_REPO=' .dev.vars 2>/dev/null | cut -d'"' -f2)}"
if [ -z "$repo" ]; then
	echo "GITHUB_REPO not set (env or .dev.vars); nothing to prepare" >&2
	exit 1
fi

mkdir -p container-context
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
	if gh api "repos/$repo/contents/$f" --jq '.content' 2>/dev/null | base64 -d > "container-context/$f.tmp"; then
		mv "container-context/$f.tmp" "container-context/$f"
		echo "fetched $f from $repo"
	else
		rm -f "container-context/$f.tmp"
		echo "warning: could not fetch $f from $repo (store warmup will be skipped)" >&2
	fi
done
