#!/usr/bin/env bash
# builder-vendor —— stage the SDK into the microsite builder's Docker context.
#
# The builder image installs its deps from builder/package.json into
# /opt/builder/node_modules and copies that tree into every build workspace. An
# owner's page can therefore import only what is in that tree — which is why a
# hosted page could render text and nothing else: @standmeet/sdk was not there.
#
# The SDK is a workspace package, not a published one, and the builder's Docker
# context is ./builder, so the image cannot COPY it from sdk/. Stage it here
# instead. Same shape as `prod-app: app-build` — the artifact is produced on the
# host first, because that is where it can be produced.
#
# ⚠️ The failure mode of that shape is a STALE artifact: the image copies whatever
# is on disk and prints success either way. So this script never copies silently —
# it builds what is missing and says what it staged.

set -euo pipefail

cd "$(dirname "$0")/.."/..

VENDOR="builder/vendor/@standmeet"
# The closure @standmeet/sdk needs at runtime. sdk-core and agent-core are its
# dependencies; react/react-dom are peers and already in the builder image.
PKGS="sdk-core agent-core sdk"

# dirOf —— workspace directory for a package name (they do not match one-to-one).
dirOf() {
  case "$1" in
    sdk-core)   echo "sdk/packages/core" ;;
    agent-core) echo "sdk/packages/agent-core" ;;
    sdk)        echo "sdk/packages/react" ;;
    *) echo "unknown package: $1" >&2; return 1 ;;
  esac
}

rm -rf builder/vendor
mkdir -p "$VENDOR"

for pkg in $PKGS; do
  src="$(dirOf "$pkg")"
  if [ ! -f "$src/dist/index.js" ]; then
    echo "[builder-vendor] $pkg has no dist — building it"
    pnpm -F "@standmeet/$pkg" build >/dev/null
  fi
  if [ ! -f "$src/dist/index.js" ]; then
    echo "[builder-vendor] FAILED: $src/dist/index.js still missing after build" >&2
    exit 1
  fi
  mkdir -p "$VENDOR/$pkg"
  cp "$src/package.json" "$VENDOR/$pkg/package.json"
  cp -R "$src/dist" "$VENDOR/$pkg/dist"
  echo "[builder-vendor] staged @standmeet/$pkg ($(find "$VENDOR/$pkg/dist" -type f | wc -l | tr -d ' ') files)"
done

echo "[builder-vendor] builder/vendor ready"
