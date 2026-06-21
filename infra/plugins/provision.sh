#!/usr/bin/env bash
# provision.sh —— materialize the REAL third-party MCP servers into their sandbox
# plugin directories (infra/plugins/<id>/node_modules).
#
# node_modules is gitignored (we don't commit a vendored npm tree); this script
# installs it on demand so the sandbox e2e specs have real server code to bwrap.
# It installs in a temp dir OUTSIDE the pnpm monorepo (a bare `npm install` under
# infra/ walks up to the workspace root and dies), then copies node_modules in.
#
# Idempotent: skips a plugin whose node_modules already exists. Run from anywhere;
# `make dev-up` runs it before bringing the stack up.
#
# NOTE: this is the dev/e2e provisioning path. In prod, owner-installed MCP
# plugins live as artifacts in object storage (MinIO) and are materialized per
# launch — the unified install path (#135). This script is the stand-in until
# that lands.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

install_into() {
  local plugin="$1" pkg="$2"
  if [ -d "$DIR/$plugin/node_modules" ]; then
    echo "[provision] $plugin: already present, skip"
    return
  fi
  local tmp
  tmp="$(mktemp -d)"
  ( cd "$tmp" && npm init -y >/dev/null 2>&1 \
      && npm install "$pkg" --no-audit --no-fund >/dev/null )
  mkdir -p "$DIR/$plugin"
  cp -R "$tmp/node_modules" "$DIR/$plugin/"
  rm -rf "$tmp"
  echo "[provision] $plugin <- $pkg"
}

# install_python_into —— Python MCP server. Installed via a one-shot container
# whose interpreter MATCHES the backend's: python:3.12-ALPINE (musl libc, same as
# the alpine backend image). A glibc (debian) wheel's native .so (regex._regex,
# pydantic-core, lxml) won't load under the backend's musl python — so we pull
# musllinux wheels here. Lands at <plugin>/pkg; the manifest runs it with
# PYTHONPATH=/plugin/pkg.
install_python_into() {
  local plugin="$1" pkg="$2"
  if [ -d "$DIR/$plugin/pkg" ]; then
    echo "[provision] $plugin: already present, skip"
    return
  fi
  mkdir -p "$DIR/$plugin/pkg"
  docker run --rm -v "$DIR/$plugin/pkg:/out" python:3.12-alpine \
    pip install --target /out "$pkg" --no-cache-dir -q
  echo "[provision] $plugin (python) <- $pkg"
}

install_into everything "@modelcontextprotocol/server-everything@2026.1.26"
install_into fsmcp      "@modelcontextprotocol/server-filesystem@2026.1.14"
# fetch —— shared by both netfetch (allow_net) and cagedfetch (--network=none);
# they read the same immutable code, differ only in network policy.
install_python_into fetch "mcp-server-fetch==2026.6.4"
echo "[provision] done"
