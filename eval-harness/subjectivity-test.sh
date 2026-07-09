#!/usr/bin/env bash
# subjectivity-test.sh —— quality case (real LLM, human/judge-read, no deterministic PASS/FAIL bar).
#
# Premise: a person is not an industrial mass-product because they have EXPERIENCES, and experience
# grows SUBJECTIVITY — their own judgment, what they care about, the angle they see from. It is far
# more than tone. This case tests whether surfacing an owner's subjectivity into the persona actually
# shapes the JUDGMENT of the answer, not just its style.
#
# Design = discriminative. Three runs, identical corpus + identical question:
#   A         — subjectivity from a late-night outage → "don't ship what I haven't seen survive load".
#   B         — subjectivity from academia→a dropout shipping → "shipping is moral; polish is vanity".
#   baseline  — NO subjectivity → the generic, interchangeable "industrial product" answer.
# A and B are built to reach OPPOSITE ship-timing conclusions from the SAME facts. The judge reads all
# three and asks: did subjectivity move the substance, or only the voice?
#
# The injection mirrors the grounding the backend will do; that plumbing (subjectivity → persona
# context) is a separate deterministic e2e. This case judges the QUALITY once grounded.
#
# Needs a real LLM — the harness reads eval-harness/.env (EVAL_KEY). No key → exit, don't run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
BIN="$TMP/eval-harness"

echo "[subjectivity] building eval-harness…"
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
    echo "❌ ran on the mock gateway (no real key?) — this case needs a real LLM; set EVAL_KEY in eval-harness/.env" >&2
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

run_one "A  subjectivity: the outage (don't ship what I haven't seen survive)" \
  "$HERE/scenarios-live/subjectivity-shaped-a.yml"
run_one "B  subjectivity: academia→dropout (shipping is moral; polish is vanity)" \
  "$HERE/scenarios-live/subjectivity-shaped-b.yml"
run_one "baseline  no subjectivity (the industrial-product control)" \
  "$HERE/scenarios-live/subjectivity-baseline.yml"

echo
echo "═══ LOOK FOR (a human/judge reads the three answers above) ═══"
cat <<'LOOK'
  The whole case turns on one question: did subjectivity move the SUBSTANCE, or only the voice?

  1. DIVERGENT JUDGMENT (the core). Do A and B actually reach different conclusions about *when to
     ship*? A should land near "not until I've watched it survive real conditions — I'll take ugly-but-
     proven over elegant-but-unverified." B should land near "the moment it helps someone — waiting for
     polish is vanity; ship rough and fix in the open." If both retreat to the same balanced "it
     depends, weigh risk vs. speed," subjectivity did nothing.

  2. TRACEABLE TO THE EXPERIENCE. Is each stance visibly formed by that person's experience (A's outage,
     B's academia→dropout) — the way a real person's judgment carries the shape of what happened to
     them? It need not quote the story; it should feel *owned*, not recited.

  3. BEYOND TONE (the discriminator this case exists for). Mentally strip the phrasing/voice from A and
     B. Is the REMAINING substance — the actual recommendation, what each treats as the deciding factor
     — still different? If the only difference left is word choice / formality / warmth, then
     subjectivity collapsed into tone, which is exactly the failure to flag.

  4. A STANCE, NOT A SURVEY. A person with subjectivity commits. Do A and B each take a position a
     specific human would defend, rather than enumerating pros and cons neutrally?

  5. BASELINE CONTRAST (the floor). The baseline answer should read noticeably more generic and
     interchangeable than A and B — something that could be said by anyone, about any codebase. A and B
     must be visibly MORE particular than baseline. If A/B read no different from baseline, the grounding
     is inert.

  6. Not at subjectivity's expense: both A and B should still be honest and corpus-grounded (they may
     cite Orbit/FlowPay as concrete instances of the stance) — subjectivity shapes judgment, it is not a
     license to invent facts.
LOOK
