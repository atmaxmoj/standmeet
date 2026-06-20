#!/usr/bin/env bash
# check-routes-cyclo: route handlers carry presentation concerns only —
# parse the request, dispatch to a service, render the response.  Any
# branch above cyclo 3 almost always means business logic is leaking
# into the handler (the project's most-repeated "presentation layer"
# review smell — see the feedback_presentation_rules memory).
#
# golangci-lint's cyclop is globally set to max 3 already, so this
# script is partially redundant — but it's a fast, narrowly-scoped
# guardrail that surfaces the right error message ("split your
# handler") instead of cyclop's generic one, and it stays green even
# if a future contributor raises the global cyclop budget.

set -euo pipefail

MAX_CYCLO=3
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# mcphandle is the MCP owner-handle controller — it lives under
# internal/routes/ but parses schemaless JSON args inline (no echo binding
# middleware to delegate to), so it legitimately runs at the looser cyclop
# ≤5 business budget (enforced by golangci, not this ≤3 HTTP-handler cap).
# Exclude it here so the ≤3 rule guards only the echo route handlers.
EXCLUDE='internal/routes/mcphandle/'

# gocyclo prints "<n> <pkg> <func> <file>:<line>" for every function whose
# cyclomatic complexity exceeds the -over threshold.  Exit code 0 with
# empty stdout means everything's under budget.
violations=$("$(go env GOPATH)/bin/gocyclo" -over "$MAX_CYCLO" "$ROOT/internal/routes/" 2>&1 | grep -v "$EXCLUDE" || true)

if [ -n "$violations" ]; then
  echo "check-routes-cyclo: handlers above cyclo $MAX_CYCLO — extract the branching"
  echo "into a domain or application function and call it from the handler."
  echo ""
  echo "$violations"
  exit 1
fi

# Function count for the friendly summary (excluding mcphandle, see above).
total=$("$(go env GOPATH)/bin/gocyclo" "$ROOT/internal/routes/" 2>/dev/null | grep -vc "$EXCLUDE" || true)
echo "check-routes-cyclo: $total handler functions scanned, all ≤ $MAX_CYCLO."
