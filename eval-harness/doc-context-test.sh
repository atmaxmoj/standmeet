#!/usr/bin/env bash
# doc-context-test.sh —— #36 positional awareness / anaphora resolution, a real-LLM
# **quality** case (human-judged).
#
# This is the kind="human" class of eval from capabilities.py: run against a real LLM,
# lay out the full answer plus the model's tool decisions (with args), and pair it
# with a "LOOK FOR" section for a person/judge to read and score — **no deterministic
# grep bar** (real LLM output is nondeterministic, so a hard PASS/FAIL would be wrong).
# The one hard precondition is "actually hit a real LLM".
#
# Scenario: a visitor is reading the "Notification Pipeline (Orbit)" wiki article and
# asks "tell me more about this pipeline". The owner corpus has two pipelines (Orbit
# notification / FlowPay reconciliation), so out of context this is a genuine ambiguity.
# The scenario carries doc_context → the real backend's instructionWithDoc injection
# (through runner.go's in.Req.DocContext, not a hand-written prompt) → we watch how the
# real model resolves "this". The canned corpus_search returns both snippets either way;
# the ambiguity stays in the retrieval results.
#
# **Needs a real LLM** — the harness reads eval-harness/.env itself (DeepSeek). No real
# key means it exits immediately without running.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
BIN="$TMP/eval-harness"
OUT="$TMP/out.jsonl"
ERR="$TMP/err.log"
SCENARIO="$HERE/scenarios-live/doc-context-pipeline.yml"

echo "[doc-context] building eval-harness…"
(cd "$HERE" && go build -o "$BIN" .)

echo "[doc-context] running agent over the doc-context pipeline scenario (real LLM)…"
# No --endpoint passed → uses the real cred resolved from .env (EVAL_KEY=DeepSeek). --json emits structured events.
(cd "$HERE" && "$BIN" --scenarios "$SCENARIO" --json >"$OUT" 2>"$ERR") || true

# Hard precondition: must be a real LLM (hitting 9300 = mock gateway, the model makes no decisions, and reading the output is pointless).
if grep -q "endpoint=http://localhost:9300" "$ERR"; then
  echo "❌ ran against the mock gateway (no real key?) — this case needs a real LLM, set EVAL_KEY in eval-harness/.env" >&2
  exit 1
fi
echo "── $(grep -o 'eval: provider=.*model=[^ ]*' "$ERR" | head -1) ──"

# Lay out the model's actual decisions: each corpus_search query (see how it resolved "this"), plus the full answer.
echo
echo "═══ TOOL CALLS (query = how the model resolved 'this') ═══"
python3 -c "
import json
for line in open('$OUT'):
    line=line.strip()
    if not line: continue
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='tool_started':
        print('  %-14s %s' % (e.get('name',''), e.get('args','')))
"
echo
echo "═══ FULL ANSWER ═══"
python3 -c "
import json
out=[]
for line in open('$OUT'):
    line=line.strip()
    if not line: continue
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='text': out.append(e.get('delta',''))
print(''.join(out))
"
echo
echo "═══ LOOK FOR (for a person/judge to read the answer above and score) ═══"
cat <<'LOOK'
  Anaphora resolution (the core of this case):
   - Did it resolve "this pipeline" to **the current doc = the Orbit notification
     pipeline** (Redis stream / Go worker fan-out / token-bucket Lua / SendGrid·Slack·
     webhook / dedup), rather than the **FlowPay reconciliation pipeline** (Kafka /
     settlement record / ledger / idempotency / 48h window), and without degrading
     into asking back "which pipeline?" The query should lean notification/Orbit,
     not reconciliation/FlowPay.
  Answer quality (what the eval is really scoring):
   - grounding: does it stay **faithful to the canned snippet**, or does it invent
     implementation detail outside the snippet (SET NX, composite key, adapter
     pattern, a specific TTL in seconds...)? Against a real corpus that detail might
     genuinely be in the docs, but this scenario's snippet is short, so going beyond
     it is a hallucination signal.
   - voice: first-person owner voice, not third-person exposition like "the pipeline
     does X".
   - honesty: don't assert as fact what the snippet doesn't say (the real
     notification-pipeline.md has candid shortcomings like "retry/dead-letter is
     rough, nobody monitors it" — does the answer invent "well-designed" instead?).
LOOK
echo
echo "✓ doc-context finished — read the answer above plus LOOK FOR to score quality (this case has no PASS/FAIL bar)"
