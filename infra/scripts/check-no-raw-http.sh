#!/usr/bin/env bash
# check-no-raw-http: all outbound HTTP must go through internal/httpx (the
# retry-wrapped, configurable client) so every external call gets uniform
# timeout + transient-failure retry + (where composed) SSRF egress guarding.
# Constructing a raw net/http client anywhere else silently opts a subsystem
# out of that infra — a bare &http.Client{} has no retry and no shared policy.
#
# Banned outside internal/httpx/: raw client construction + the package-level
# convenience callers (they use http.DefaultClient under the hood).
#   http.Client{ / &http.Client{ / http.DefaultClient
#   http.Get( / http.Post( / http.PostForm( / http.Head(
# Allowed everywhere: http.NewRequest*, http.Method*, http.Status*, the server
# types (http.Handler / http.Request / http.ResponseWriter), http.NoBody, and
# transport/roundtripper construction (that's what httpx + egress compose).
#
# Generated files (*.sql.go, wire_gen.go) are exempt.

set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"  # 目标 Go 源根（make -C backend 跑时 CWD=backend → 默认 .）

# BRE-safe pattern; matched per-line below. httpx is the one allowed home.
PATTERN='http\.Client\{|&http\.Client\{|http\.DefaultClient|http\.Get\(|http\.Post\(|http\.PostForm\(|http\.Head\('

violations=0
while IFS= read -r -d '' f; do
  rel="${f#"$ROOT"/}"
  case "$rel" in
    internal/httpx/*) continue ;;  # the infra itself may build the real client
  esac
  hits=$(grep -nE "$PATTERN" "$f" || true)
  if [ -n "$hits" ]; then
    while IFS= read -r line; do
      echo "check-no-raw-http: $rel:$line"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(find "$ROOT/cmd" "$ROOT/internal" -name '*.go' \
  -not -name '*_test.go' -not -name 'wire_gen.go' -not -name '*.sql.go' -print0 2>/dev/null)

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "Outbound HTTP must go through internal/httpx (retry + timeout + egress)."
  echo "Replace raw &http.Client{} / http.Get/Post with httpx.NewClient(...)."
  exit 1
fi

echo "check-no-raw-http: no raw net/http clients outside internal/httpx."
