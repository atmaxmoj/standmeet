#!/usr/bin/env sh
# lint-if-dirty —— 跑 `make lint`，但**同一棵树只跑一次**。
#
# 为什么这个机制存在（2026-08-18 的效率复盘）：完整 lint 要 3–9 分钟（今天见过 552 秒），
# 而它每次提交至少被跑**两遍** —— 我自己先跑一次确认绿，`pre-commit` 再跑一次同样的东西，
# 同一棵树、同样的结果。今晚 11 次提交里 6 次是这个形状，纯等待约 30 分钟。
#
# **写规矩没用**：「记得别重复跑」是要人记住的纪律，而昨晚写进 CLAUDE.md 的批处理规则
# 今晚就回潮了（[[structure-means-no-responsibility-class]]：需要人维护的检查就是职责类）。
# 所以这里改成**结构**：lint 通过时把当时的树指纹落盘，下次指纹一样就直接放行。
# 忘不忘记都一样 —— 重复的那次自己消失。
#
# 指纹取什么：`git status --porcelain` + 所有被跟踪文件的哈希（`git ls-files -s`）。
#   - 覆盖已跟踪文件的任何内容改动（ls-files -s 带 blob hash）
#   - 覆盖新增/删除/未跟踪（porcelain）
#   - **不**覆盖 .gitignore 掉的东西（node_modules、构建产物）—— 那些不影响 lint 结论
#
# 逃生门：`FORCE_LINT=1 make lint-cached` 强制重跑（换了工具链、改了 lint 脚本本身
# 而它恰好没被 git 跟踪时用）。

set -eu

CACHE_DIR="${TMPDIR:-/tmp}/standmeet-lint-cache"
mkdir -p "$CACHE_DIR"

# tree_fingerprint —— 这棵树此刻的内容指纹。
tree_fingerprint() {
  {
    git ls-files -s
    git status --porcelain --untracked-files=all
  } | shasum -a 256 | cut -d' ' -f1
}

fp=$(tree_fingerprint)
stamp="$CACHE_DIR/$fp"

if [ "${FORCE_LINT:-}" = "1" ]; then
  echo "lint-if-dirty: FORCE_LINT=1 —— 忽略缓存，完整重跑"
elif [ -f "$stamp" ]; then
  echo "lint-if-dirty: 这棵树上一次 lint 已通过（$(cat "$stamp")），内容没变，跳过。"
  echo "               强制重跑：FORCE_LINT=1 make lint-cached"
  exit 0
fi

make lint

# 只有真的通过才落盘 —— `set -e` 保证失败到不了这里。
date '+%H:%M:%S' > "$stamp"
# 只留最近 20 份，别让 /tmp 无限长。
ls -t "$CACHE_DIR" | tail -n +21 | while read -r old; do rm -f "$CACHE_DIR/$old"; done
