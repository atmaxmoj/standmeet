#!/usr/bin/env bash
# check-domain-facade-boundary.sh —— 一个域的**内部实现只能经它自己的 facade 访问**。
#
# 规矩(owner):"domain 被引用需要通过自己的 facade（或 facade dir 里面的）"。落法:每个域把
# 实现藏进 internal/<domain>/internal/**(guts),域根包(+ facade*.go)只做**薄薄一层转发**。
# Go 的 internal/ 可见性本来就编译期挡住外部 import guts —— 这个 lint 是**显式声明该不变式**、
# 加 self-test、并且覆盖将来可能出现的 facade-dir 风格(那种 Go 不帮忙)。
#
# 判定:凡是**已采用 guts 约定的域**(存在 internal/<domain>/internal/ 目录),
# 域外任何包都不许 import internal/<domain>/internal/**。域自己采用后自动进入执法集,
# 不需要维护名单 —— 重构推进到哪个域,执法就长到哪个域。
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERNAL="$ROOT/backend/internal"

scan() {
  # $1 = internal dir to scan. prints violations, returns count via stdout lines.
  local internal="$1"
  python3 - "$internal" <<'PY'
import os, re, sys
internal = sys.argv[1]
# 已采用 guts 约定的域 = 存在 internal/<domain>/internal/ 子目录的域。
domains = sorted(
    d for d in os.listdir(internal)
    if os.path.isdir(os.path.join(internal, d, "internal"))
)
violations = []
for d in domains:
    guts_prefix = f"atmaxmoj/standmeet/internal/{d}/internal/"
    domain_root = os.path.join(internal, d) + os.sep
    for dirpath, _, files in os.walk(internal):
        # 域内部引用自己的 guts 合法(facade 就住这儿)。
        if (dirpath + os.sep).startswith(domain_root):
            continue
        for fn in files:
            if not fn.endswith(".go"):
                continue
            path = os.path.join(dirpath, fn)
            for line in open(path):
                if guts_prefix in line:
                    rel = os.path.relpath(path, internal)
                    violations.append(f"{rel}\t{d}")
                    break
for v in violations:
    print(v)
PY
}

hits="$(scan "$INTERNAL")"
if [ -n "$hits" ]; then
  echo "check-domain-facade-boundary: 域外代码直接 import 了某域的 internal/ guts —— 必须走 facade:"
  echo "$hits" | while IFS=$'\t' read -r f dom; do
    echo "  $f  绕过了 $dom 的 facade"
  done
  exit 1
fi

# self-test: 植入一个域外文件直接 import security guts,断言被抓,再清理。
TMPDIR="$INTERNAL/__facade_boundary_selftest__"
mkdir -p "$TMPDIR"
cat > "$TMPDIR/leak.go" <<'GO'
package selftest

import _ "github.com/atmaxmoj/standmeet/internal/security/internal/ban"
GO
planted="$(scan "$INTERNAL")"
rm -rf "$TMPDIR"
if [ -z "$planted" ]; then
  echo "check-domain-facade-boundary: self-test FAILED —— 植入的越界 import 没被抓到。"
  exit 1
fi

enforced="$(python3 -c "import os;print(len([d for d in os.listdir('$INTERNAL') if os.path.isdir(os.path.join('$INTERNAL',d,'internal'))]))")"
echo "check-domain-facade-boundary: $enforced 个域已封 guts,域外只经 facade 访问 (self-test 通过)。"
