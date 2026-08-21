#!/usr/bin/env bash
# turn-hop-failure-probe.sh —— 逼出 /api/v1/agent/turn 那一跳的**失败路径**，并检查它回给
# 跨源访客的东西够不够诚实（F-O-3）。
#
# 为什么不是一条 playwright spec：这条判据要的前置条件是「app 活着、backend 够不到」——
# 一条 spec 没法在整套跑的中途把共享的 backend 停掉再拉起来。所以它是一个按需跑的探针，
# 停 → 打 → 断言 → 起，全在一条命令里。
#
#   make turn-hop-probe            # 打 dev（默认）
#   make turn-hop-probe STACK=prod # 打 prod
#
# 断言三条：
#   1. POST 回 502（不是挂住、不是 500）；
#   2. 502 的正文是**人话**，不是技术串；
#   3. 502 **带 CORS 头** —— 否则浏览器把整个回应吞掉，控制台只剩一句
#      "No 'Access-Control-Allow-Origin'"，也就是 F-O-3 当初把人指错方向的那句话。
#      第 3 条正是 2026-08-21 量到红的那一条：`corsHeadersFromBackend` 去**刚刚倒掉的那个
#      后端**要头，自然一个也要不到。
set -uo pipefail

STACK="${STACK:-dev}"
if [ "$STACK" = "prod" ]; then
  APP_URL="${APP_URL:-http://localhost:38227}"
  STOP="make prod-stop-svc SVC=backend"
  START="make prod-start-svc SVC=backend"
else
  APP_URL="${APP_URL:-http://localhost:3000}"
  STOP="make dev-stop-svc SVC=backend"
  START="make dev-restart-svc SVC=backend"
fi
ORIGIN="${ORIGIN:-http://localhost:41999}"
OUT=$(mktemp)

cleanup() { echo "[probe] bringing the backend back"; $START >/dev/null 2>&1; rm -f "$OUT"; }
trap cleanup EXIT

echo "[probe] stopping the backend under $APP_URL"
$STOP >/dev/null 2>&1
sleep 2

curl -s -i -X POST "$APP_URL/api/v1/agent/turn" \
  -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer probe' -d '{"message":"probe"}' --max-time 30 > "$OUT"

PRE=$(mktemp)
curl -s -i -X OPTIONS "$APP_URL/api/v1/agent/turn" \
  -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type' --max-time 20 > "$PRE"

fail=0
# preflight 也要过 —— 它不过的话浏览器**根本不发**下面那个 POST，访客看到的仍是一句
# 「CORS 没配好」，而真正的原因（后端够不到）一个字都不会出现。
head -1 "$PRE" | grep -qE ' (200|204) ' \
  || { echo "FAIL: preflight did not pass: $(head -1 "$PRE")"; fail=1; }
grep -qi '^access-control-allow-origin:' "$PRE" \
  || { echo "FAIL: the preflight reply carries no access-control-allow-origin"; fail=1; }
rm -f "$PRE"

head -1 "$OUT" | grep -q ' 502 ' || { echo "FAIL: expected 502, got: $(head -1 "$OUT")"; fail=1; }
grep -qi 'the instance did not answer' "$OUT" \
  || { echo "FAIL: the body is not the human sentence"; fail=1; }
grep -qi '^access-control-allow-origin:' "$OUT" \
  || { echo "FAIL: the 502 carries no access-control-allow-origin — a browser swallows it and the console blames CORS"; fail=1; }

if [ "$fail" -eq 0 ]; then
  echo "[probe] PASS — 502 · human sentence · CORS headers present"
else
  echo "[probe] --- response ---"; head -12 "$OUT"
fi
exit "$fail"
