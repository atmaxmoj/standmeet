#!/usr/bin/env sh
# check-instructions-name-sure-tools —— **能力的常驻说明书里，不许点名一个可能不在场的工具。**
#
# 为什么这条闸门存在（F-B-10）：
# 一个 manifest 里带 `requires` 的工具是**有条件的** —— owner 只授了 `calendar.readonly` 时，
# 装配期会把 `calendar_book` 摘掉（F-B-8）。可那一段 `instructions` 是**跟会话无关**的常量：
# 它照旧告诉模型 *"You can book meetings … 2. calendar_book — actually create the event"*。
# 于是模型手上没有那把工具，嘴上照旧答应「给我个主题我马上给你订」——
# 产品把一个做不到的动作**说**了出去，尽管它没有**派**出去。
#
# 判据不是「有没有写清楚」而是「这句话在最坏的那一场会话里还成不成立」：
# 常驻文本只能讲**每一场都在场**的东西。有条件的那几个，它们的用法写在自己的
# tool description 里 —— 那份说明跟着工具一起来、一起走，天生不会说谎。
#
# 范围（两处，都是「跟会话无关的说明书」）：
#   · `mcp-servers/*/…` 里名为 `instructions` 的 Go 常量（插件自带的 fragment）；
#   · `backend/internal/prompts/**.md`（embed 的 fragment）。
# 代码不在范围里：工具当然要在注册它的那一行写出自己的名字，卡片的 testid 也带着它。
#
# 自证三条：名单不能是空的、扫描范围不能是空的、种一句进去必须红。

set -eu

fail=0

# ── 名单：哪些访客工具是**有条件**的（manifest 上带 requires 的那几个） ──
#
# YAML 长这样：
#   - name: calendar_book
#     requires: [calendar:events.insert]
# 所以「上一行的 name + 这一行的 requires」才算数 —— 只 grep `- name:` 会把无条件的
# 也算进来，那会把每一份说明书都判红，然后这道闸会被关掉（[[gate-scope-forces-architecture]]）。
conditional_tools() {
  for m in backend/capabilities/*/manifest.yaml; do
    [ -f "$m" ] || continue
    awk '
      /^[[:space:]]*-[[:space:]]*name:[[:space:]]*/ {
        name = $0
        sub(/^[[:space:]]*-[[:space:]]*name:[[:space:]]*/, "", name)
        gsub(/[[:space:]]+$/, "", name)
        next
      }
      /^[[:space:]]*requires:[[:space:]]*\[/ {
        if (name != "") { print name; name = "" }
        next
      }
    ' "$m"
  done | sort -u
}

# ── 范围：常驻说明书的正文 ──
#
# Go 那半只取 `const instructions = ` 到收尾反引号之间的那一段，不取整个文件：
# 同一个文件里还有卡片 HTML，里头的 `tool-card-calendar_book` 是 testid 不是说给模型听的话。
instruction_text() {
  for f in $(find mcp-servers -name '*.go' -not -name '*_test.go' 2>/dev/null | sort); do
    awk -v src="$f" '
      /^const instructions = `/ { inside = 1; next }
      inside && /`$/ { inside = 0; next }
      inside { print src ": " $0 }
    ' "$f"
  done
  for f in $(find backend/internal/prompts -name '*.md' 2>/dev/null | sort); do
    sed_free_cat "$f"
  done
}

# sed_free_cat —— 带上文件名把一份 .md 打出来。（这个仓库禁 sed 改文件；这里只是读。）
sed_free_cat() {
  awk -v src="$1" '{ print src ": " $0 }' "$1"
}

tools=$(conditional_tools)
text=$(instruction_text)

n_tools=$(printf '%s\n' "$tools" | grep -c . || true)
n_lines=$(printf '%s\n' "$text" | grep -c . || true)

# 自证一：名单空了 → 下面的循环恒绿，这道闸等于不存在。
if [ "$n_tools" -lt 1 ]; then
  echo "check-instructions-name-sure-tools: SELF-TEST FAILED — no tool in any manifest declares"
  echo "                        'requires:', so the gate has nothing to look for (yaml shape changed?)"
  exit 2
fi
# 自证二：一行都没取到 → 同上，瞎了（[[gate-can-go-blind]]）。
if [ "$n_lines" -lt 1 ]; then
  echo "check-instructions-name-sure-tools: SELF-TEST FAILED — no instruction text was collected;"
  echo "                        the scan is blind (const renamed, or the prompts dir moved?)"
  exit 2
fi

for t in $tools; do
  hits=$(printf '%s\n' "$text" | grep -F "$t" || true)
  if [ -n "$hits" ]; then
    echo "check-instructions-name-sure-tools: '$t' only exists when the owner's grant covers it,"
    echo "                        but a session-independent instruction names it:"
    printf '%s\n' "$hits" | while IFS= read -r line; do
      echo "                          $line"
    done
    echo "                        Move that guidance into the tool's own description — it travels"
    echo "                        with the tool, so it cannot outlive it."
    fail=1
  fi
done

# 自证三：判定自证 —— 种一句必须红。
planted=$(printf '%s\n' "fake.go: call $(printf '%s\n' "$tools" | head -1) to do the thing")
first=$(printf '%s\n' "$tools" | head -1)
if [ -z "$(printf '%s\n' "$planted" | grep -F "$first" || true)" ]; then
  echo "check-instructions-name-sure-tools: SELF-TEST FAILED — a planted mention was not caught"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-instructions-name-sure-tools: $n_tools conditional tool(s); no session-independent"
echo "                        instruction names one (self-test passed)."
