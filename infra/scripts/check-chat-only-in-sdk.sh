#!/usr/bin/env sh
# check-chat-only-in-sdk —— a visitor chat turn runs only through the SDK's chat.
#
# Three chat implementations once grew apart: the app's, the microsite widget's, the embed's. Each
# app improvement skipped the other two, and the recruiter-facing microsite got the thinnest one.
# The chat now lives once, in sdk/packages/react/src/chat (docs/design/sdk-chat-inheritance.md), and
# every surface renders it. This gate keeps it that way: the surfaces below may not run a turn
# themselves, so a new chat surface can only be a use of the SDK's chat.
#
# Surfaces scanned: the app, the microsite template, the embed, the SDK's other widgets.
# A turn is run by: the agent-core loop, the agent-turn streamer, or the core client's streamMessage.

set -eu

SURFACES="app/src builder/template/src sdk/packages/embed/src sdk/packages/react/src/widgets"
PATTERN='VisitorTurnAgent|httpAgentTurnStreamer|\.streamMessage\(|streamChatMessage'

offenders=$(find $SURFACES \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
  | xargs -0 grep -nE "$PATTERN" 2>/dev/null \
  | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' || true)

if [ -n "$offenders" ]; then
  echo "check-chat-only-in-sdk: a surface runs a chat turn itself:"
  echo "$offenders"
  echo "  → render the SDK's chat instead: <Agent>, useChatController + ChatTranscript + Composer, or useChat."
  exit 1
fi
echo "check-chat-only-in-sdk: every chat turn runs through @standmeet/sdk's chat."
