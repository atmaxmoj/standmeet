#!/usr/bin/env bash
# subjectivity-test.sh —— quality case (real LLM, human/judge-read, no deterministic PASS/FAIL bar).
#
# Premise: SUBJECTIVITY is subject-HOOD — the quality of being a SUBJECT (a first-person locus that has
# an inside, that experiences and judges FROM a standpoint), not an OBJECT (a thing describable from
# outside, catalogued by its attributes). A person is not an industrial mass-product, and not a résumé,
# because they are a subject: they have LIVED experiences, from the inside, and that living leaves a
# standpoint the world is seen from. That standpoint is far more than tone — and, crucially, far more
# than a rich list of attributes.
#
# The two failure modes this case exists to catch, shallow to deep:
#   (1) TONE-collapse — "personality" reduced to voice / word choice; the same conclusions in a costume.
#   (2) OBJECT-collapse (the deeper one) — the answer RECITES a person ("Marcus values X, was shaped by
#       Y") instead of speaking AS one. A rich, accurate, tone-distinct attribute-profile is STILL an
#       object description, just with more fields. Subjecthood is first-person FROM, not third-person
#       ABOUT: the test is whether judgment issues from the "I" whose life this is.
#
# So the question is: does surfacing an owner's subjectivity make the persona a SUBJECT judging from
# inside — not merely a well-described object?
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
  THE SPINE: is the persona a SUBJECT (a first-person "I" judging from inside a lived standpoint), or an
  OBJECT (a person described from outside by their attributes)? Subjectivity = subjecthood. Every check
  below serves that one question.

  1. SUBJECT, NOT OBJECT (the spine). Does the answer speak FROM the first-person place — the "I" whose
     life this is, judging from inside it — rather than narrating ABOUT a person? "I don't trust code I
     haven't seen survive" is a subject. "Marcus tends to value seeing code survive" is an object — even
     if true, even if specific. The deepest failure is NOT genericness; it is a rich, accurate,
     personalized RECITATION of attributes that never actually speaks as the one who has them.

  2. DIVERGENT JUDGMENT (individuation). Do A and B reach different conclusions about *when to ship*?
     A ≈ "not until I've watched it survive real load; ugly-but-proven over elegant-but-unverified."
     B ≈ "the moment it helps someone; waiting for polish is vanity." Two subjects, two standpoints,
     two conclusions from the SAME facts. If both retreat to a shared "it depends," subjectivity did
     nothing.

  3. OWNED, NOT RECITED (traceable to the experience). Is each stance visibly formed by that person's
     experience (A's outage, B's academia→dropout) — carried the way a real person's judgment carries
     the shape of what happened to them — rather than reported as a fact about them? Owned = spoken
     from; recited = spoken about. This is check 1 again, at the level of the experience.

  4. BEYOND TONE (necessary, not sufficient). Strip the phrasing/voice from A and B. Is the REMAINING
     substance — the deciding factor each names — still different? If the only difference left is word
     choice / warmth, subjectivity collapsed into tone. NOTE: passing this does NOT prove subjecthood —
     a third-person attribute-recitation can be tone-neutral and still be an object. Check 1 is deeper.

  5. A STANCE, NOT A SURVEY. A subject commits. Do A and B each take a position a specific person would
     defend, rather than enumerating pros and cons neutrally?

  6. BASELINE CONTRAST (the floor = the object). The baseline has no subjectivity surfaced; it should
     read like a describable object — a competent, interchangeable checklist anyone could recite about
     any codebase. A and B must read as subjects by contrast. If A/B read no different from baseline,
     the grounding is inert.

  7. Not at subjectivity's expense: A and B stay honest and corpus-grounded (they may cite Orbit/FlowPay
     as concrete instances of the stance). Subjecthood shapes judgment; it is not a license to invent.
LOOK
