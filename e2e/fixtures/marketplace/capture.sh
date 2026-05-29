#!/usr/bin/env bash
# capture.sh — 抓真实 skill marketplace snapshots 进 .raw/
# 用法：bash e2e/fixtures/marketplace/capture.sh
# 或经 Makefile: make capture-marketplace-fixtures
#
# 完成后跑 trim.sh 把 raw 截短进 git 路径。
#
# - github: https://api.github.com/repos/anthropics/skills/contents/skills
#           真有，每次 capture 抓最新目录列表
# - skillsmp: api.skillsmp.com 是 design 假设的商业渠道，目前不存在真实
#             upstream。skillsmp.json 是手写 fixture (3 个 skill)，模拟
#             api.skillsmp.com/v1/skills/search 的响应形态。capture 不动它。

set -u
UA="StandMeet-fixture-capture/0.1 (+https://github.com/wangsijie/standmeet)"
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
