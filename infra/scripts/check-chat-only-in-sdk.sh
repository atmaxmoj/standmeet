#!/usr/bin/env sh
# check-chat-only-in-sdk —— a visitor chat turn runs only through the SDK's chat.
#
# Three chat implementations once grew apart: the app's, the microsite widget's, the embed's. Each
# app improvement skipped the other two, and the recruiter-facing microsite got the thinnest one.
# The chat now lives once, in sdk/packages/react/src/chat (docs/design/sdk-chat-inheritance.md), and
# every surface renders it. This gate keeps it that way: the surfaces below may not run a turn
# themselves, so a new chat surface can only be a use of the SDK's chat.
#
# Surfaces scanned: the app's UI, the microsite template, the embed, the SDK's other widgets. The
# app's route handlers (app/src/app/api) are server-side proxies, not surfaces.
# A turn is run by: the agent-core loop, the agent-turn streamer, the core client's streamMessage,
# or any code that names the turn endpoint itself (a hand-written fetch + SSE parser — refactor
# ledger R21: the gate used to match the SDK's own names only, and that shape passed it).
#
# ROOT —— the tree to scan (the self-test points it at a planted tree).

set -eu

ROOT="${ROOT:-.}"
SURFACES="app/src builder/template/src sdk/packages/embed/src sdk/packages/react/src/widgets"
PATTERN='VisitorTurnAgent|httpAgentTurnStreamer|\.streamMessage\(|streamChatMessage|agent/turn'

cd "$ROOT"
offenders=$(find $SURFACES -path 'app/src/app/api' -prune -o \( -name '*.ts' -o -name '*.tsx' \) -print0 \
  2>/dev/null \
  | xargs -0 grep -nE "$PATTERN" 2>/dev/null \
  | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' || true)

if [ -n "$offenders" ]; then
  echo "check-chat-only-in-sdk: a surface runs a chat turn itself:"
  echo "$offenders"
  echo "  → render the SDK's chat instead: <Agent>, useChatController + ChatTranscript + Composer, or useChat."
  exit 1
fi
echo "check-chat-only-in-sdk: every chat turn runs through @standmeet/sdk's chat."
