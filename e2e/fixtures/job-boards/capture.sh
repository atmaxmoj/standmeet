#!/usr/bin/env bash
# capture.sh — 重新抓 raw job board snapshots 进 .raw/
# 用法：bash e2e/fixtures/job-boards/capture.sh
# 或经 Makefile: make capture-job-fixtures
#
# 完成后跑 trim.sh 把 raw 截短进 git 路径。

set -u
UA="StandMeet-fixture-capture/0.1 (+https://github.com/wangsijie/standmeet)"
ROOT="$(cd "$(dirname "$0")" && pwd)"
RAW="$ROOT/.raw"

mkdir -p "$RAW"/{greenhouse,lever,ashby,remoteok,wwr,hn,smartrecruiters,workable}

fetch() {
  local out="$1" url="$2"
  local code size
  code=$(curl -sS -A "$UA" -o "$out" -w "%{http_code}" "$url" || echo "000")
  size=$(wc -c < "$out" 2>/dev/null || echo 0)
  if [ "$code" != "200" ] || [ "$size" -lt 200 ]; then
    echo "  - $url → $code/$size CULL"
    rm -f "$out"
    return 1
  fi
  echo "  + $url → $size B"
}

echo "[GREENHOUSE]"
GH_COS=(airbnb stripe vercel figma anthropic dropbox instacart pinterest reddit gusto duolingo elastic gitlab cloudflare datadog mongodb mercury chime brex lyft robinhood asana affirm fivetran samsara)
for co in "${GH_COS[@]}"; do
  fetch "$RAW/greenhouse/$co.day1.json" "https://boards-api.greenhouse.io/v1/boards/$co/jobs?content=true"
done

echo "[LEVER]"
LV_COS=(leverdemo highspot jobvite palantir)
for co in "${LV_COS[@]}"; do
  fetch "$RAW/lever/$co.day1.json" "https://api.lever.co/v0/postings/$co?mode=json"
done

echo "[ASHBY]"
ASHBY_SLUGS=(Ashby Linear Notion posthog supabase)
for s in "${ASHBY_SLUGS[@]}"; do
  fetch "$RAW/ashby/$s.day1.json" "https://api.ashbyhq.com/posting-api/job-board/$s"
done

echo "[REMOTEOK]"
fetch "$RAW/remoteok/api.day1.json" "https://remoteok.com/api"

echo "[WWR]"
WWR_CATS=(remote-back-end-programming-jobs remote-front-end-programming-jobs remote-full-stack-programming-jobs remote-devops-sysadmin-jobs remote-product-jobs remote-design-jobs remote-customer-support-jobs remote-management-and-finance-jobs remote-sales-and-marketing-jobs all-other-remote-jobs)
for c in "${WWR_CATS[@]}"; do
  fetch "$RAW/wwr/$c.day1.rss" "https://weworkremotely.com/categories/$c.rss"
done

echo "[HN]"
fetch "$RAW/hn/whoishiring.day1.json" "https://hacker-news.firebaseio.com/v0/user/whoishiring.json"
# Find latest "Who is hiring" thread
LATEST_THREAD=""
for id in $(jq -r '.submitted[:6] | .[]' "$RAW/hn/whoishiring.day1.json" 2>/dev/null); do
  title=$(curl -sS -A "$UA" "https://hacker-news.firebaseio.com/v0/item/$id.json" | jq -r '.title // ""')
  if [[ "$title" == "Ask HN: Who is hiring?"* ]]; then
    LATEST_THREAD="$id"
    fetch "$RAW/hn/item-$id.day1.json" "https://hacker-news.firebaseio.com/v0/item/$id.json"
    break
  fi
done
# Grab first 8 comments
if [ -n "$LATEST_THREAD" ]; then
  for cid in $(jq -r ".kids[:8] | .[]" "$RAW/hn/item-$LATEST_THREAD.day1.json" 2>/dev/null); do
    fetch "$RAW/hn/item-$cid.day1.json" "https://hacker-news.firebaseio.com/v0/item/$cid.json"
  done
fi

echo "[SMARTRECRUITERS]"
SR_SLUGS=(visa)
for s in "${SR_SLUGS[@]}"; do
  fetch "$RAW/smartrecruiters/$s.day1.json" "https://api.smartrecruiters.com/v1/companies/$s/postings?limit=200"
done

echo "[WORKABLE]"
WK_SUBS=(typeform mux marshmallow intercom mistralai rechargehq)
for s in "${WK_SUBS[@]}"; do
  fetch "$RAW/workable/$s.day1.json" "https://apply.workable.com/api/v1/widget/accounts/$s"
done

echo ""
echo "Done. Run \`bash e2e/fixtures/job-boards/trim.sh\` to write trimmed versions for git."
