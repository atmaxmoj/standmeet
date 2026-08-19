#!/usr/bin/env bash
# trim.sh — 把 .raw/ 里的 raw 捕获截到 ≤ 8 条 jobs / items，写到 git path
# 用法：make trim-job-fixtures                  全部截
#       make trim-job-fixtures KIND=remoteok    只截一个源（跟 capture 同一个开关）

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
RAW="$ROOT/.raw"
KIND="${KIND:-}"

# want —— 这一节要不要跑。KIND 空 = 全跑。跟 capture.sh 同一个词，别各叫各的。
want() { [ -z "$KIND" ] || [ "$KIND" = "$1" ]; }

if [ ! -d "$RAW" ]; then
  echo "no .raw/ found — run capture.sh first"
  exit 1
fi

# Greenhouse: .jobs[0:8]
if want greenhouse; then
echo "[GREENHOUSE]"
mkdir -p "$ROOT/greenhouse"
for f in "$RAW"/greenhouse/*.json; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  jq '.jobs |= .[0:8]' "$f" > "$ROOT/greenhouse/$base"
  echo "  ✓ $base"
done
fi

# Lever: array[0:8]
if want lever; then
echo "[LEVER]"
mkdir -p "$ROOT/lever"
for f in "$RAW"/lever/*.json; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  jq '.[0:8]' "$f" > "$ROOT/lever/$base"
  echo "  ✓ $base"
done
fi

# Ashby: .jobs[0:8]
if want ashby; then
echo "[ASHBY]"
mkdir -p "$ROOT/ashby"
for f in "$RAW"/ashby/*.json; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  jq '.jobs |= .[0:8]' "$f" > "$ROOT/ashby/$base"
  echo "  ✓ $base"
done
fi

# RemoteOK: array[0] legal notice + [1:9]
#
# **不要在这里"顺手清洗"字段**。上游发 `"location": "San Francisco, "` 就照原样留着 ——
# fixture 的职责是复现真实世界，替身一客气，产品那边缺了归一化也没人看得见（UX-88 就是
# 这么活到生产的）。归一化属于 ingest 边界（backend fetch.readableJobs），不属于替身。
if want remoteok; then
echo "[REMOTEOK]"
mkdir -p "$ROOT/remoteok"
for f in "$RAW"/remoteok/*.json; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  jq '.[0:9]' "$f" > "$ROOT/remoteok/$base"
  echo "  ✓ $base"
done
fi

# WWR: keep RSS preamble + first 8 <item>
if want wwr; then
echo "[WWR]"
mkdir -p "$ROOT/wwr"
for f in "$RAW"/wwr/*.rss; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  python3 - "$f" "$ROOT/wwr/$base" <<'PY'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
content = open(src).read()
items = re.findall(r'<item>.*?</item>', content, re.DOTALL)
header_match = re.search(r'^(.*?<item>)', content, re.DOTALL)
header = header_match.group(1).rsplit('<item>', 1)[0] if header_match else ''
trailer_match = re.search(r'(</item>)([^<]*</channel>.*)$', content, re.DOTALL)
trailer = trailer_match.group(2) if trailer_match else '</channel></rss>'
kept = '\n'.join(items[:8])
open(dst, 'w').write(header + kept + trailer)
PY
  echo "  ✓ $base"
done
fi

# HN: whoishiring trim to submitted[0:30]; thread trim kids[0:8]; comments copy
if want hn; then
echo "[HN]"
mkdir -p "$ROOT/hn"
if [ -f "$RAW/hn/whoishiring.day1.json" ]; then
  jq '.submitted |= .[0:30]' "$RAW/hn/whoishiring.day1.json" > "$ROOT/hn/whoishiring.day1.json"
  echo "  ✓ whoishiring.day1.json"
fi
for f in "$RAW"/hn/item-*.day1.json; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  # Heuristic: items with kids array > 8 = thread, trim kids; else = comment, copy
  has_many_kids=$(jq '.kids // [] | length > 8' "$f")
  if [ "$has_many_kids" = "true" ]; then
    jq '.kids |= .[0:8]' "$f" > "$ROOT/hn/$base"
  else
    cp "$f" "$ROOT/hn/$base"
  fi
  echo "  ✓ $base"
done
fi

# SmartRecruiters: .content[0:8]
if want smartrecruiters; then
echo "[SMARTRECRUITERS]"
mkdir -p "$ROOT/smartrecruiters"
for f in "$RAW"/smartrecruiters/*.json; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  jq '.content |= .[0:8] | .limit = 8 | .totalFound = (.content | length)' "$f" > "$ROOT/smartrecruiters/$base"
  echo "  ✓ $base"
done
fi

# Workable: shape is {name, description}, no jobs — straight copy
if want workable; then
echo "[WORKABLE]"
mkdir -p "$ROOT/workable"
for f in "$RAW"/workable/*.json; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  cp "$f" "$ROOT/workable/$base"
  echo "  ✓ $base (account metadata, jobs endpoint TBD)"
done
fi

echo ""
echo "Trimmed. Sizes:"
for d in greenhouse lever ashby remoteok wwr hn smartrecruiters workable; do
  printf "  %-18s %s\n" "$d" "$(du -sh "$ROOT/$d" 2>/dev/null | cut -f1)"
done
