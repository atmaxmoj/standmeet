#!/usr/bin/env sh
# check-doc-make-targets —— **文档里用代码体印出来的 `make X`，必须真的能跑。**
#
# 为什么这条闸门存在：
# 项目自己的规矩是「所有 Docker / 测试操作走 Makefile，没有配方就先加配方」。于是文档写
# `make capture-job-fixtures`，读的人（人或 agent）照着敲 —— 得到 `No rule to make target`。
# 那条 recipe 从来没被加过，脚本却在 `e2e/fixtures/job-boards/capture.sh` 躺着。结果是
# **规矩把唯一合规的入口指向了一个不存在的门**，谁要真去做那件事，只能绕过规矩裸跑脚本。
# 第一次跑这道闸抓到四个：capture-job-fixtures / trim-job-fixtures / backup / restore ——
# 四个的脚本全都在，缺的只是那一行 wrapper。
#
# 判据是「Makefile 里声明没声明这个目标」。
#
# **不要用 `make -n <t>` 来探**（第一版这么写，然后超时了）：GNU make 在 `-n` 下**照样执行**
# 含 `$(MAKE)` 的配方行 —— 这样子 make 才能把自己的命令也打印出来。而本仓库的 `test:` 整条
# 配方是用 `\` 接成的**一行**，里头既有 `pnpm exec playwright test` 又有 `$(MAKE) archive-failures`，
# 于是 `make -n test` 会**真的把整套 e2e 跑起来**。一个只想问「这个目标存在吗」的探针，
# 绝不能有把生产配方跑起来的可能。
#
# 代价是这里得自己认 Makefile 的目标行。所以下面配了三条自证：认得出已知目标、
# 认不出已知的非目标、并且 Makefile 一旦引入 `include`（我们的 grep 看不进去）就报失败而不是放行。
#
# 提案怎么办：文档里讨论一个**还没建**的目标是正当的（"未来需要个 `make verify-fixtures`"）。
# 那种句子必须在同一行带上标记 `(not built yet)`，**一个词一个意思**，不接受近义词 ——
# 否则「待加 / 计划 / TODO / 推荐」各写各的，闸门要么瞎要么误伤，最后被关掉。
#
# 自证：不存在的目标必须判缺；存在的目标必须判在；扫不到任何引用要当失败报（范围瞎了）。

set -eu

fail=0
# 标记只认这个**短语**，括号里怎么补充随意（`(not built yet — 这是被否掉的那一半)` 也算）。
# 第一版把闭括号也算进标记里，于是加了说明的那一行没被认出来 —— 标记要认意思，不认标点。
MARKER='not built yet'
MAKEFILE=Makefile

# Makefile 一有 include，下面这份目标表就只看得见一半 —— 那时要报失败，不能继续放行。
if grep -qE '^[[:space:]]*(-|s)?include[[:space:]]' "$MAKEFILE"; then
  echo "check-doc-make-targets: SELF-TEST FAILED — $MAKEFILE now uses include; this scan only"
  echo "                        reads the top-level file and would miss targets defined elsewhere."
  exit 2
fi

# 目标行：行首的名字，冒号前可以并列多个（`a b:`），排除变量赋值（`a := x`）和 pattern rule。
targets=$(grep -E '^[a-zA-Z0-9_.%/-]+([[:space:]]+[a-zA-Z0-9_.%/-]+)*:([^=]|$)' "$MAKEFILE" \
  | awk -F: '{print $1}' | tr ' ' '\n' | grep -v '^$' | sort -u)

target_exists() {
  printf '%s\n' "$targets" | grep -qx "$1"
}

# 范围用 git grep（只看**被追踪**的文件）—— node_modules 里几百份第三方 README 全是
# `make release` / `make build-browser`，按目录扫会被它们淹掉，然后这道闸只能被加豁免名单。
# 不用 `ls-files | xargs grep`：BSD 的 xargs 没有 `-r`，输入一空就把 grep 挂在 stdin 上
# 等到天荒地老（第一版就是这么超时的）。
#
# 只认**代码体**里的调用：反引号开头那个 `make x`。散文里的 "make sure" / "make it"
# 不是命令，第一版没收窄，156 个「目标」里 148 个是英文单词。
refs=$(git grep -nE '`make [a-z][a-zA-Z0-9_-]*' -- '*.md' 2>/dev/null || true)

# 逐条判。用 printf 逐行读而不是 for-in，文件名/行文里有空格时才不会被切碎。
printf '%s\n' "$refs" | while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  case "$ref" in *"$MARKER"*) continue ;; esac
  loc=${ref%%:*}
  rest=${ref#*:}
  lineno=${rest%%:*}
  for t in $(printf '%s' "$ref" | grep -oE '`make [a-z][a-zA-Z0-9_-]*' | awk '{print $2}'); do
    if ! target_exists "$t"; then
      echo "check-doc-make-targets: $loc:$lineno prints \`make $t\` — no such target."
      echo "                        add the recipe, or mark that line $MARKER if it is a proposal."
      echo "$loc:$lineno" >> "${TMPDIR:-/tmp}/doc-make-targets.fail"
    fi
  done
done

# while 跑在 subshell 里，fail 传不出来 —— 用落地的文件计数（[[write-with-no-receipt]]：
# 别让「没报错」冒充「没问题」）。
FAILFILE="${TMPDIR:-/tmp}/doc-make-targets.fail"
if [ -f "$FAILFILE" ]; then
  fail=$(grep -c . "$FAILFILE" || echo 1)
  rm -f "$FAILFILE"
else
  fail=0
fi

# 扫描范围自证：一条引用都没取到的话，上面那个循环恒绿。
n=$(printf '%s\n' "$refs" | grep -c . || true)
if [ "$n" -lt 5 ]; then
  echo "check-doc-make-targets: SELF-TEST FAILED — only $n backticked \`make …\` reference(s)"
  echo "                        found across tracked *.md; the scan is blind."
  exit 2
fi

# 判定自证（两个方向都要）：不存在的必须判缺，存在的必须判在。
if target_exists definitely-not-a-target; then
  echo "check-doc-make-targets: SELF-TEST FAILED — a nonexistent target was judged to exist"
  exit 2
fi
for known in lint test dev-up; do
  if ! target_exists "$known"; then
    echo "check-doc-make-targets: SELF-TEST FAILED — \`make $known\` is declared in $MAKEFILE"
    echo "                        but the target scan missed it."
    exit 2
  fi
done

[ "$fail" -eq 0 ] || exit 1
echo "check-doc-make-targets: $n \`make …\` reference(s) in docs, all resolve (self-test passed)."
