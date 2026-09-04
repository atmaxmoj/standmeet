#!/usr/bin/env bash
# capture.sh — capture real skill marketplace snapshots into .raw/
# Usage: bash e2e/fixtures/marketplace/capture.sh
# or via Makefile: make capture-marketplace-fixtures
#
# When done, run trim.sh to trim raw into the git path.
#
# - github: https://api.github.com/repos/anthropics/skills/contents/skills
#           real; each capture fetches the latest directory listing
# - skillsmp: api.skillsmp.com is a commercial channel the design assumes, with no
#             real upstream today. skillsmp.json is a hand-rolled fixture (3 skills)
#             simulating the api.skillsmp.com/v1/skills/search response shape.
#             Capture doesn't touch it.

set -u
UA="StandMeet-fixture-capture/0.1 (+https://github.com/atmaxmoj/standmeet)"
ROOT="$(cd "$(dirname "$0")" && pwd)"
RAW="$ROOT/.raw"

mkdir -p "$RAW/github"

echo "[GITHUB anthropics/skills]"
curl -sS -A "$UA" \
  -H "Accept: application/vnd.github.v3+json" \
  -o "$RAW/github/contents.json" \
  -w "  + contents/skills → %{size_download} B (status %{http_code})\n" \
  "https://api.github.com/repos/anthropics/skills/contents/skills"

echo
echo "[SKILLSMP]"
echo "  skipped — no public api.skillsmp.com upstream; e2e/fixtures/marketplace/skillsmp.json"
echo "  is a hand-rolled fixture matching the design's MARKET shape."
