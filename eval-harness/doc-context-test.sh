#!/usr/bin/env bash
# doc-context-test.sh —— #36 位置感知 / 指代解析,真 LLM **质量**用例(human-judged)。
#
# 这是 capabilities.py 里 kind="human" 那类 eval:真 LLM 跑,把完整答案 + 模型的
# tool 决策(含 args)摊出来,配「LOOK FOR」给人/judge 读着判 —— **不卡确定性 grep
# bar**(真 LLM 输出不确定,硬判 PASS/FAIL 是错的)。唯一的硬前置是「确实在打真 LLM」。
#
# 场景:访客正读「Notification Pipeline (Orbit)」那篇 wiki,问「tell me more about
# this pipeline」。owner corpus 里有两条 pipeline(Orbit 通知 / FlowPay 对账),脱离
# 上下文是真歧义。scenario 带 doc_context → 真后端 instructionWithDoc 注入(走 runner.go
# 的 in.Req.DocContext,不是手写 prompt)→ 看真模型怎么解析「this」。canned corpus_search
# 同返两条 snippet,歧义留检索结果里。
#
# **需真 LLM** —— harness 自读 eval-harness/.env(DeepSeek)。没真 key 直接退出,不跑。
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
# 不传 --endpoint → 用 .env 解析的真 cred(EVAL_KEY=DeepSeek)。--json 出结构化事件。
(cd "$HERE" && "$BIN" --scenarios "$SCENARIO" --json >"$OUT" 2>"$ERR") || true

# 硬前置:必须真 LLM(打到 9300 = mock gateway,模型不做决策,看了白看)。
if grep -q "endpoint=http://localhost:9300" "$ERR"; then
  echo "❌ 跑在 mock gateway 上(没真 key?)—— 本用例需真 LLM,设 eval-harness/.env 的 EVAL_KEY" >&2
  exit 1
fi
echo "── $(grep -o 'eval: provider=.*model=[^ ]*' "$ERR" | head -1) ──"

# 摊开模型真决策:每次 corpus_search 的 query(看它把「this」解析成了什么),+ 完整答案。
echo
echo "═══ TOOL CALLS (query = 模型对「this」的解析) ═══"
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
echo "═══ LOOK FOR (人/judge 读上面答案判) ═══"
cat <<'LOOK'
  指代解析(本用例的核心):
   - 把「this pipeline」解析成了**当前 doc = Orbit 通知 pipeline**(Redis stream / Go
     worker fan-out / token-bucket Lua / SendGrid·Slack·webhook / dedup),而不是
     **FlowPay 对账 pipeline**(Kafka / settlement record / ledger / idempotency /
     48h window),也没退化成反问「which pipeline?」。query 应朝通知/Orbit 方向,
     不是对账/FlowPay。
  答案质量(eval 真正要判的):
   - grounding:有没有**忠于 canned snippet**?还是编了 snippet 外的实现细节
     (SET NX、composite key、adapter pattern、TTL 具体秒数…)?——真 corpus 下这些
     可能本就在文档里,但本 scenario 的 snippet 很短,超出即 hallucination 信号。
   - voice:第一人称 owner 口吻,不是「the pipeline does X」第三人称讲解。
   - 诚实:snippet 没说的别拍胸脯当事实(notification-pipeline.md 原文是有「retry/
     dead-letter 很糙、没人监控」这类坦诚短板的——会不会被无中生有成「设计精良」)。
LOOK
echo
echo "✓ doc-context 跑完 —— 读上面答案 + LOOK FOR 判质量(本用例无 PASS/FAIL bar)"
