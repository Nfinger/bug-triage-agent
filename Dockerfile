# Coding-agent sandbox image. The base tag MUST match the installed
# @cloudflare/sandbox npm package version (see package.json).
FROM docker.io/cloudflare/sandbox:0.12.7

# Toolchain the coding agent needs on every run: pnpm (pinned to the target
# repo's packageManager) with a fixed store path shared by all checkouts.
# The base image ships node+npm but no corepack, so install pnpm via npm.
RUN npm install -g pnpm@10.15.0 \
	&& pnpm config set --global store-dir /root/.pnpm-store

# Warm the pnpm store from the target repo's manifests, snapshotted into the
# build context by scripts/prepare-container-context.sh. Only public registry
# tarballs land in the image — no repository code and no credentials. If the
# snapshot is absent or fetch fails, the image still builds (cold store) and
# installs at runtime just download normally.
COPY container-context/ /opt/warmup/
RUN if [ -f /opt/warmup/pnpm-lock.yaml ]; then \
		cd /opt/warmup && pnpm fetch || echo "pnpm store warmup failed; continuing with cold store"; \
	fi
