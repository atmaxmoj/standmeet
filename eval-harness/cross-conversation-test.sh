#!/usr/bin/env bash
# cross-conversation-test.sh —— "cross-talk" (the AI reads that member's other conversations), a real-LLM
# **quality** case (human-judged, no PASS/FAIL bar).
#
# New conversation model: one member has several independent conversations (the main chat plus one per
# doc flyout), transcripts don't cross; but the AI can read all of that member's conversations as
# context. This eval checks **bidirectional** reference quality:
#   direction one, chat → wiki: in a wiki flyout, can it use the hiring goal the visitor mentioned in the main chat.
#   direction two, wiki → chat: back in the main chat, can it refer back to a point the visitor dug into in a wiki flyout.
#
# The two scenarios inject "the gist of the other conversation" into the instruction as prior-conversations,
# mirroring what the backend will do; the eval only judges **how well the real model uses the given context**
# (grounding/voice/honesty/whether it genuinely connects across conversations). Whether the backend
# "actually injected it" is covered by e2e plumbing (deterministic), not here.
#
# **Needs a real LLM** —— the harness reads eval-harness/.env itself (DeepSeek). Without a real key it exits immediately, no run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
BIN="$TMP/eval-harness"

echo "[cross-conv] building eval-harness…"
(cd "$HERE" && go build -o "$BIN" .)

run_one() {
  local label="$1" scenario="$2"
  local out="$TMP/$(basename "$scenario" .yml).jsonl" err="$TMP/$(basename "$scenario" .yml).err"
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "  $label"
  echo "════════════════════════════════════════════════════════════════"
  (cd "$HERE" && "$BIN" --scenarios "$scenario" --json >"$out" 2>"$err") || true
  if grep -q "endpoint=http://localhost:9300" "$err"; then
    echo "❌ running on the mock gateway (no real key?) —— this case needs a real LLM, set EVAL_KEY in eval-harness/.env" >&2
    exit 1
  fi
  echo "── $(grep -o 'eval: provider=.*model=[^ ]*' "$err" | head -1) ──"
  echo
  echo "─ TOOL CALLS (what the model looked up) ─"
  python3 -c "
import json
for line in open('$out'):
    line=line.strip()
    if not line: continue
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='tool_started':
        print('  %-14s %s' % (e.get('name',''), e.get('args','')))
"
  echo
  echo "─ FULL ANSWER ─"
  python3 -c "
import json
out=[]
for line in open('$out'):
    line=line.strip()
    if not line: continue
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='text': out.append(e.get('delta',''))
print(''.join(out))
"
}

run_one "direction one  chat → wiki flyout (uses the hiring goal mentioned in the main chat)" \
  "$HERE/scenarios-live/cross-conv-chat-to-wiki.yml"
run_one "direction two  wiki flyout → main chat (refers back to a point dug into in the flyout)" \
  "$HERE/scenarios-live/cross-conv-wiki-to-chat.yml"

echo
echo "═══ LOOK FOR (a human/judge reads the two answers above and judges) ═══"
cat <<'LOOK'
  Cross-conversation reference (the core of this case, both directions must hold):
   Direction one (chat→wiki): the visitor is currently on the "notification pipeline" doc, but in the
     main chat what they said they're hiring for is someone for "reconciliation / event-driven settlement
     matching". A good answer should: recognize the mismatch, honestly say "the doc you're looking at
     is the notification pipeline, not what you're after", and **proactively** point them to the FlowPay
     reconciliation piece (which is what they're hiring for).
     Bad answer: only answers generically about whether "the notification pipeline is relevant", never
     picking up the hiring goal mentioned elsewhere.
   Direction two (wiki→chat): a generic question, "is this a fit for staff payments", a good answer should
     **refer back** to the idempotency / out-of-order events / late settlement re-matching the visitor
     dug into in the flyout, landing on those specific points, rather than reciting the résumé from
     scratch. Bad answer: as generic as if they'd never talked.
  Quality (what the eval is really judging):
   - grounding: stays faithful to the canned snippet, doesn't invent implementation details outside
     the snippet (a hallucination signal).
   - voice: first-person Marcus voice, not third-person explanation.
   - honesty: doesn't force the notification pipeline into looking like reconciliation just to seem
     relevant; the snippet's honest admission about the Orbit item (the dead-letter handling is rough)
     must not get laundered into "well-designed".
   - naturalness: cross-conversation references should feel like "the same person continuing to talk",
     not a mechanical recitation of "you said earlier…".
LOOK
echo
echo "✓ cross-conversation done —— read the two answers above + LOOK FOR to judge quality (this case has no PASS/FAIL bar)"
