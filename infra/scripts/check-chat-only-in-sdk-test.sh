#!/usr/bin/env sh
# check-chat-only-in-sdk-test —— the gate goes red on a surface that runs a turn itself, and stays
# green on a clean surface and on the app's server-side proxy routes.

set -eu

GATE="$(cd "$(dirname "$0")" && pwd)/check-chat-only-in-sdk.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/app/src/components" "$tmp/app/src/app/api/v1/agent/turn"
echo 'export const ok = 1;' > "$tmp/app/src/components/Clean.tsx"
echo 'await fetch(`${B}/api/v1/agent/turn`);' > "$tmp/app/src/app/api/v1/agent/turn/route.ts"
if ! ROOT="$tmp" sh "$GATE" >/dev/null; then
  echo "check-chat-only-in-sdk self-test: FAILED — a clean surface (and the proxy route) went red"
  exit 1
fi

echo 'const r = await fetch(`${base}/api/v1/agent/turn`, { method: "POST" });' \
  > "$tmp/app/src/components/OwnChat.tsx"
if ROOT="$tmp" sh "$GATE" >/dev/null; then
  echo "check-chat-only-in-sdk self-test: FAILED — a hand-written turn fetch stayed green"
  exit 1
fi
echo "check-chat-only-in-sdk: self-test passed (a planted hand-written turn fetch goes red)."
