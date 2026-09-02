#!/usr/bin/env sh
# build-cadence —— before every prod build, put the **recent build cadence**
# right in front of the eyes.
#
# Why this mechanism exists (from the 2026-08-18 efficiency retro): tonight, over
# 11 hours, `make prod-app` ran 8 times, each 2-3 minutes; 20 idle gaps of ten
# minutes or more added up to about 6 hours, and the bulk of it was build + lint.
# The real disease on the ledger isn't "builds are slow" — it's **fixing one at a
# time**: each defect walking its own "edit -> build -> eyeball -> lint -> commit"
# loop.
#
# **Why this isn't just a written rule**: last night "collect reds, don't fix
# mid-drive" already went into CLAUDE.md, and tonight it backslid anyway. The
# reason is every red has, **in the moment**, a legitimate case for closing it
# right away — while the payoff of batching only shows up several rounds later.
# At the moment of the decision, the cost is invisible
# ([[structure-means-no-responsibility-class]]).
#
# So this doesn't block, doesn't judge, doesn't ask anyone to remember anything —
# it does exactly one thing: **make the invisible cost visible**.
# The decision is still the human's, but at least made with the facts in view.
#
# The criterion (why 3 times/hour): one prod build is ~2.5 minutes. 3 of them is
# ~8 minutes of pure waiting, already enough to be worth batching. This isn't a
# threshold alarm, it's a reminder.

set -eu

LOG="${TMPDIR:-/tmp}/standmeet-build-log"
NOW=$(date +%s)
KIND="${1:-build}"

# Keep only the last hour's records.
if [ -f "$LOG" ]; then
  awk -v cutoff="$((NOW - 3600))" '$1 >= cutoff' "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
else
  : > "$LOG"
fi

n=$(grep -c . "$LOG" || true)
if [ "$n" -ge 3 ]; then
  first=$(head -1 "$LOG" | cut -d' ' -f1)
  mins=$(( (NOW - first) / 60 ))
  echo ""
  echo "  ┌─ build cadence ─────────────────────────────────────────"
  echo "  │  This is build #$((n + 1)) in the last ${mins} minutes."
  echo "  │  One prod build is ~2.5 minutes — about $(( (n + 1) * 5 / 2 )) minutes spent waiting so far."
  echo "  │"
  echo "  │  If there are other changes still pending, batch them before building:"
  echo "  │  one build + one eyeball pass + one lint + one commit."
  echo "  └─────────────────────────────────────────────────────────"
  echo ""
fi

echo "$NOW $KIND" >> "$LOG"
