#!/usr/bin/env sh
# machine-witness —— during a full run, log one line to stdout every minute: "who is on this
# machine right now".
#
# **Why it's needed.** The full suite takes over an hour, and whether a red is evidence depends on
# what the machine looked like **at the moment it appeared**. I got burned twice in a row on
# 2026-08-19:
#   · Round 2, I was running prod driving + real-model eval alongside it, load hit 64, all 10 reds voided;
#   · Round 3, I declared "exclusive", and an hour later another project's whole e2e (lucerna-e2e)
#     came up, holding 1.5 cores, and the 30s-timeout reds in the back half were forever ambiguous.
# Both times I **asserted machine state once at startup and then treated it as always true**. It is
# not always true.
#
# So this makes no judgment, sets no threshold, blocks nothing — it only leaves evidence: after the
# run, read the log, and every red can be matched to the load and neighbours it was born with.
# The verdict is left to a person, the facts to this log line.
#
# The output is mixed into the same log as playwright's lines; pick it out by the `[machine]` prefix:
#   grep '\[machine\]' full.log
#
# Other projects' containers are **not selected by a name allowlist**: an allowlist would miss the
# next new project. Any running container not belonging to this repo's compose projects
# (standmeet-dev / standmeet-prod) counts as a neighbour.

set -eu

INTERVAL="${WITNESS_INTERVAL:-60}"

# neighbours —— running containers not belonging to standmeet, grouped and counted by compose project name.
neighbours() {
  docker ps --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null \
    | grep -v '^standmeet-' | grep -v '^$' | sort | uniq -c \
    | awk '{ printf "%s(%s) ", $2, $1 }'
}

while true; do
  load=$(uptime | awk -F'load average[s]*:' '{ gsub(/^[ \t]+/, "", $2); print $2 }')
  n=$(neighbours)
  printf '[machine %s] load=%s neighbours=%s\n' \
    "$(date -u +%H:%M:%SZ)" "$load" "${n:-none}"
  sleep "$INTERVAL"
done
