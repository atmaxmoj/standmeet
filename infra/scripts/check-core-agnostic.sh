#!/usr/bin/env bash
# check-core-agnostic.sh —— #135 结构锁 Layer 4:内核零能力(字符串棘轮)。
#
# 内核(CORE_DIRS)里出现任何**具体能力/连接器**的名字 = 泄漏。go-arch-lint 只管包与包
# 之间的 import 箭头,抓不到"内核文件同包里写了 booking 逻辑"这类泄漏(那种文件只 import
# 合法包,箭头全绿)。本守卫用字符串棘轮补这个盲区 —— 计划 Part 0 Layer 4。
#
# 棘轮基线 backend/.core-agnostic-baseline 记录**当前已知**泄漏(每行 "file<TAB>token",已排序):
#   - 基线外的新命中        → 红(不许新增泄漏 —— 这就是"就算 AI 忘了结构也兜得住")
#   - 基线里的条目扫不到了  → 红(逼你把它从基线删掉;基线只能缩不能长)
# 每 drain 一刀,基线缩一截;缩到空 → 删基线文件 → 守卫进纯红模式(任何命中都红)。
#
# 排除:_test.go、`//` 或 `*` 起头的注释行。CORE_DIRS 只含内核三包;连接器层
# (internal/connector*)、postgres、mailer、组装根(cmd/server)、插件叶子
# (internal/plugins/<cap>)、mcp-servers/ 都**不是**内核 —— 那里出现能力名是合法的。
#
# 用法:
#   check-core-agnostic.sh          检查(默认)。退出码 0=clean,1=有违规。
#   check-core-agnostic.sh seed     打印当前命中集(拿去写/更新基线文件)。
#
# 自测在 check-core-agnostic-test.sh:往内核种一个 "calendar" 文件 → 断言变红 → 清掉 → 变绿。

set -euo pipefail
cd "$(dirname "$0")/../.."

BASELINE="backend/.core-agnostic-baseline"

# 内核三包 —— 看它们不该能推断出任何具体能力/连接器存在。
CORE_DIRS="backend/internal/usecases backend/internal/inference backend/internal/domain"

# 具体能力/连接器名。都是内核里"正当理由几乎为零"的词。特意不收:
#   - bare "mail"/"email"/"google"/"corpus" —— email 是身份、corpus 是内核原语,收了会误伤
#     未来的合法内核代码。mail 只收 camelCase 的 Mail[A-Z] 与 mail. (MailProxy/MailSender/mail.X)。
TOKENS="calendar caldav freebusy booking booker smtp gcal retrieval summarize summarise"

# 打印当前命中集(每行 "file<TAB>token",已 sort -u)。
current_hits() {
  find $CORE_DIRS -name '*.go' ! -name '*_test.go' 2>/dev/null | sort | while IFS= read -r f; do
    [ -f "$f" ] || continue
    # 去掉注释行(// 或 * 起头)再匹配 —— 历史注释里的词不算泄漏。
    body=$(grep -vE '^[[:space:]]*(//|\*)' "$f" 2>/dev/null || true)
    for tok in $TOKENS; do
      if printf '%s\n' "$body" | grep -qi -- "$tok"; then
        printf '%s\t%s\n' "$f" "$tok"
      fi
    done
    # mail 特例:只收 Mail[A-Z] / mail. —— 躲开 email 身份与 owner.Email。
    if printf '%s\n' "$body" | grep -qE 'Mail[A-Z]|mail\.'; then
      printf '%s\t%s\n' "$f" "mail"
    fi
  done | sort -u
}

if [ "${1:-check}" = "seed" ]; then
  current_hits
  exit 0
fi

# ── check 模式 ──
hits_f=$(mktemp)
base_f=$(mktemp)
trap 'rm -f "$hits_f" "$base_f"' EXIT

current_hits > "$hits_f"
sort -u "$BASELINE" 2>/dev/null > "$base_f" || true

new=$(comm -23 "$hits_f" "$base_f")     # 只在当前命中里 → 新泄漏
stale=$(comm -13 "$hits_f" "$base_f")   # 只在基线里 → 已清,基线该缩

rc=0
if [ -n "$new" ]; then
  echo "check-core-agnostic: 内核出现新的具体能力/连接器泄漏(基线外)。" >&2
  echo "内核三包不该能推断出这些能力存在 —— 把逻辑挪去插件/连接器层,或经通用 seam 反向伸手:" >&2
  printf '%s\n' "$new" | sed 's/^/  + /' >&2
  rc=1
fi
if [ -n "$stale" ]; then
  echo "check-core-agnostic: 基线里下列条目已扫不到 —— 请从 $BASELINE 删掉(基线只能缩)。" >&2
  echo "跑 'infra/scripts/check-core-agnostic.sh seed > $BASELINE' 重新播种即可:" >&2
  printf '%s\n' "$stale" | sed 's/^/  - /' >&2
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  n=$(wc -l < "$hits_f" | tr -d ' ')
  echo "check-core-agnostic: kernel clean against baseline ($n known-leak entries, ratchet holds)."
fi
exit "$rc"
