#!/usr/bin/env bash
# provision.sh —— materialize the REAL third-party MCP servers into their sandbox
# plugin directories (infra/plugins/<id>/node_modules).
#
# node_modules is gitignored (we don't commit a vendored npm tree); this script
# installs it on demand so the sandbox e2e specs have real server code to bwrap.
# It installs in a temp dir OUTSIDE the pnpm monorepo (a bare `npm install` under
# infra/ walks up to the workspace root and dies), then copies node_modules in.
#
# Idempotent, but NOT blindly: each installed bundle carries a `.spec` stamp of the
# exact package spec it was built from, and a plugin is reinstalled whenever that
# stamp doesn't match what this script now asks for. A plain "dir exists → skip"
# made a bundle UNREPAIRABLE by the tool that creates it: changing the pin here
# changed nothing on any machine that had already provisioned, and re-running
# provisioning printed "already present" — which reads like success.
# (Cost: `mcp-server-fetch==2026.6.4` declared `mcp>=1.1.3`, pip took mcp 2.x, which
# renamed `McpError` → `MCPError`. The fetch plugin died at IMPORT, the capability
# never bound, and re-provisioning could not fix it.)
# Run from anywhere; `make dev-up` runs it before bringing the stack up.
#
# NOTE: this is the dev/e2e provisioning path. In prod, owner-installed MCP
# plugins live as artifacts in object storage (MinIO) and are materialized per
# launch — the unified install path (#135). This script is the stand-in until
# that lands.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# up_to_date —— true when $1 (the bundle dir) exists AND the spec stamp INSIDE it
# equals the spec we're about to install. A mismatch, or a stamp-less legacy bundle,
# is stale: the caller wipes it and reinstalls. The stamp lives inside the bundle so
# it is removed with it and inherits its gitignore.
up_to_date() {
  local dir="$1" pkg="$2"
  [ -d "$dir" ] && [ "$(cat "$dir/.provision-spec" 2>/dev/null)" = "$pkg" ]
}

install_into() {
  local plugin="$1" pkg="$2"
  if up_to_date "$DIR/$plugin/node_modules" "$pkg"; then
    echo "[provision] $plugin: up to date ($pkg), skip"
    return
  fi
  rm -rf "$DIR/$plugin/node_modules"
  local tmp
  tmp="$(mktemp -d)"
  ( cd "$tmp" && npm init -y >/dev/null 2>&1 \
      && npm install "$pkg" --no-audit --no-fund >/dev/null )
  mkdir -p "$DIR/$plugin"
  cp -R "$tmp/node_modules" "$DIR/$plugin/"
  rm -rf "$tmp"
  echo "$pkg" > "$DIR/$plugin/node_modules/.provision-spec"
  echo "[provision] $plugin <- $pkg"
}

# install_project_into —— a node MCP server that is OUR OWN wrapper source (committed
# <plugin>/koishi-mcp.js) plus its npm dependencies declared in <plugin>/package.json.
# Unlike install_into (one third-party package run directly), here the deps are a set, so
# we install from the committed package.json. Same temp-dir dance (a bare npm install under
# infra/ walks up to the pnpm workspace root and dies), same in-bundle spec stamp — here the
# stamp is a hash of package.json, so an edited dependency set reinstalls.
install_project_into() {
  install_project_dir "$DIR/$1"
}

# install_project_dir —— the same flat-npm materialization as install_project_into, for an ABSOLUTE
# plugin dir (so it also serves the dsh-acceptance demo blocks, which live outside infra/plugins).
install_project_dir() {
  local pdir="$1"
  local plugin
  plugin="$(basename "$pdir")"
  local pkgjson="$pdir/package.json"
  local stamp
  stamp="$(shasum "$pkgjson" | cut -d' ' -f1)"
  if [ -d "$pdir/node_modules" ] \
      && [ "$(cat "$pdir/node_modules/.provision-spec" 2>/dev/null)" = "$stamp" ]; then
    echo "[provision] $plugin: up to date (package.json $stamp), skip"
    return
  fi
  rm -rf "$pdir/node_modules"
  local tmp
  tmp="$(mktemp -d)"
  cp "$pkgjson" "$tmp/package.json"
  ( cd "$tmp" && npm install --no-audit --no-fund >/dev/null )
  cp -R "$tmp/node_modules" "$pdir/"
  rm -rf "$tmp"
  echo "$stamp" > "$pdir/node_modules/.provision-spec"
  echo "[provision] $plugin (node project) <- $pkgjson"
}

# install_python_into —— Python MCP server. Installed via a one-shot container
# whose interpreter MATCHES the backend's: python:3.12-ALPINE (musl libc, same as
# the alpine backend image). A glibc (debian) wheel's native .so (regex._regex,
# pydantic-core, lxml) won't load under the backend's musl python — so we pull
# musllinux wheels here. Lands at <plugin>/pkg; the manifest runs it with
# PYTHONPATH=/plugin/pkg.
install_python_into() {
  local plugin="$1" pkg="$2"
  if up_to_date "$DIR/$plugin/pkg" "$pkg"; then
    echo "[provision] $plugin: up to date ($pkg), skip"
    return
  fi
  rm -rf "$DIR/$plugin/pkg"
  mkdir -p "$DIR/$plugin/pkg"
  docker run --rm -v "$DIR/$plugin/pkg:/out" python:3.12-alpine \
    pip install --target /out "$pkg" --no-cache-dir -q
  echo "$pkg" > "$DIR/$plugin/pkg/.provision-spec"
  echo "[provision] $plugin (python) <- $pkg"
}

# build_go_into —— a BUILTIN capability shipped as Go source in its own module
# (mcp-servers/<name>), cross-compiled to a static linux binary so it runs in the
# bwrap sandbox with no libc/interpreter at all. builtin = just an origin tag; it
# loads through the exact same sandbox_stdio path as a third-party plugin.
ROOT="$(cd "$DIR/../.." && pwd)"
build_go_into() {
  local plugin="$1" mod="$2" pkg="$3"
  # ALWAYS rebuild (no skip-if-exists): go build is cheap + cached, and skipping
  # would silently keep a stale binary when the plugin source changed — a real
  # gotcha (a source edit wouldn't reach the running sandbox until manual rm).
  mkdir -p "$DIR/$plugin"
  ( cd "$ROOT/$mod" && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
      go build -trimpath -ldflags='-s -w' -o "$DIR/$plugin/$plugin" "$pkg" )
  echo "[provision] $plugin (go static) <- $mod $pkg"
}

# The five builtin capabilities are node MCP servers (committed <plugin>/<plugin>-mcp.js +
# package.json), run as `node /plugin/<plugin>-mcp.js`. They used to be Go binaries built into
# the image; they were rewritten to JS so a block is a plain dsh/cordis plugin that CANNOT reach
# back into the Go backend (no import path exists from JS), the same isolation the sandbox gives.
install_project_into ask-visitor
install_project_into summarize
install_project_into booker
install_project_into retrieval
install_project_into mail-sender
# smtp —— the mail supplier as a stdio-MCP block wrapping nodemailer (smtp-mcp.js). Replaces the
# old in-host protocol(smtp) supplier: SMTP is an app on a protocol, so it is a block like caldav.
install_project_into smtp
# google-calendar —— Google Calendar AS a block: data (spec.yaml + binding.yaml) + the generic
# openapi-runtime engine vendored in-block (engine.js / engine_call.js, copied from the canonical
# infra/plugins/openapi/ the way socket blocks vendor gateway.js — self-contained for the sandbox
# and dsh pack). Replaces the in-host calendarAdapter. (infra/plugins/openapi/ is the engine's
# source of truth, a template copied into each openapi supplier block; it is not itself a runnable
# block, so it is not provisioned/baked.)
install_project_into google-calendar
# caldav —— CalDAV as a Koishi plugin (caldav-plugin.js) wrapped as a stdio-MCP block: injects
# Koishi's http hand for the WebDAV requests, parses iCalendar with ical.js. CalDAV is an app on
# HTTP → a block (pluggable into Koishi), not a base protocol, and carries no Go. Deps in
# infra/plugins/caldav/package.json. Credit: infra/plugins/caldav/CREDITS.
install_project_into caldav
# koishi / everything / fsmcp live in infra/dsh-acceptance/ (dsh-acceptance demos — proofs that the
# substrate can host a Koishi-ecosystem plugin / a third-party MCP server; not production
# capabilities). They are NOT baked into any product image (root .dockerignore drops
# infra/dsh-acceptance from every docker build context). But the dev sandbox-isolation e2e specs
# (koishi-poc / real-third-party-mcp-* / norm-inward-blocks / sandbox-workspace-ttl-cron /
# acl-global-master) use them as third-party fixtures: dev-plugins.json declares them at
# /srv/plugins/<name>, and docker-compose.dev.yml bind-mounts each demo dir there. So their
# node_modules must be materialized here too (flat npm, bwrap-safe), same as the real blocks.
DSH_DEMOS="$DIR/../dsh-acceptance"
# adversary — the isolation-proof fixture (security-block-isolation-adversarial): a
# sandboxed block whose tools each attempt one escape. Test-only, same demos treatment.
for demo in koishi everything fsmcp adversary; do
  install_project_dir "$DSH_DEMOS/$demo"
done
# fetch —— shared by both netfetch (allow_net) and cagedfetch (--network=none);
# they read the same immutable code (fetch-mcp.js), differ only in network policy.
# Our own JS port of the reference python fetch server: global fetch + node-html-markdown
# + robots-parser, honoring robots.txt unless DSH_FETCH_IGNORE_ROBOTS=1. JS not python so a
# block cannot reach back into the Go backend.
install_project_into fetch
echo "[provision] done"
