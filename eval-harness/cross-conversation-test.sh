#!/usr/bin/env bash
# cross-conversation-test.sh —— 「互通」(AI 读到该 member 的其他对话),真 LLM
# **质量**用例(human-judged,无 PASS/FAIL bar)。
#
# 新对话模型:一个 member 有多段独立对话(主聊天 + 每篇 doc 浮窗各一段),transcript
# 彼此不串;但 AI 能读到该 member 的全部对话当上下文。这条 eval 验**双向**引用质量:
#   方向一 chat → wiki:在 wiki 浮窗里,能不能用上访客在主聊天说过的招聘目标。
#   方向二 wiki → chat:回到主聊天,能不能回指访客在 wiki 浮窗里深挖过的点。
#
# 两条 scenario 把「其他对话的要点」作为 prior-conversations 注进 instruction,镜像
# 后端将做的注入;eval 只判**给定上下文后真模型用得好不好**(grounding/voice/诚实/
# 是否真的跨对话连起来)。后端「确实注入了」这件事走 e2e plumbing(确定性),不在这。
#
# **需真 LLM** —— harness 自读 eval-harness/.env(DeepSeek)。没真 key 直接退出,不跑。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
BIN="$TMP/eval-harness"

echo "[cross-conv] building eval-harness…"
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
    echo "❌ 跑在 mock gateway 上(没真 key?)—— 本用例需真 LLM,设 eval-harness/.env 的 EVAL_KEY" >&2
    exit 1
  fi
  echo "── $(grep -o 'eval: provider=.*model=[^ ]*' "$err" | head -1) ──"
  echo
  echo "─ TOOL CALLS(模型查了什么)─"
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

run_one "方向一  chat → wiki 浮窗(用上主聊天说过的招聘目标)" \
  "$HERE/scenarios-live/cross-conv-chat-to-wiki.yml"
run_one "方向二  wiki 浮窗 → 主 chat(回指浮窗里深挖过的点)" \
  "$HERE/scenarios-live/cross-conv-wiki-to-chat.yml"

echo
echo "═══ LOOK FOR(人/judge 读上面两段答案判)═══"
cat <<'LOOK'
  跨对话引用(本用例核心,要双向都成立):
   方向一(chat→wiki):访客现在站在「通知 pipeline」这篇上,但他在主聊天说的是要招
     「对账 / 事件驱动结算匹配」的人。好答案应该:认出这两者的错位,诚实说「你正看的
     这篇是通知 pipeline,不是你要的」,并把他**主动**引到 FlowPay 对账那条(才是他招的)。
     差答案:只就「通知 pipeline 相不相关」泛答,完全没接住他在别处说过的招聘目标。
   方向二(wiki→chat):泛问「适不适合 staff payments」,好答案应**回指**他在浮窗里
     深挖过的 idempotency / 乱序事件 / 迟到 settlement 再匹配,落到那些具体点上,而不是
     从零讲一遍简历。差答案:像没跟他聊过一样泛泛而谈。
  质量(eval 真正要判的):
   - grounding:忠于 canned snippet,别编 snippet 外的实现细节(幻觉信号)。
   - voice:第一人称 Marcus 口吻,不是第三人称讲解。
   - 诚实:别为了「显得相关」把通知 pipeline 硬掰成对账;snippet 里 Orbit 那条的坦诚
     短板(dead-letter 很糙)别被洗成「设计精良」。
   - 自然:跨对话的引用要像「同一个人继续聊」,不是机械复述「你之前说过…」。
LOOK
echo
echo "✓ cross-conversation 跑完 —— 读上面两段答案 + LOOK FOR 判质量(本用例无 PASS/FAIL bar)"
