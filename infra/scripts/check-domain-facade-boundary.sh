#!/usr/bin/env bash
# check-domain-facade-boundary.sh —— 一个域的**实现只能经它自己的 facade 包访问**。
#
# 规矩(owner):"domain 被引用需要通过自己的 facade（或 facade dir 里面的）"。落法:每个域把
# 对外协议收进 internal/<domain>/facade/(薄薄一层,一眼看全协议),实现拆成同域兄弟子包
# (entity / usecase / service / repo / db …)。域外任何包**只能 import internal/<domain>/facade**,
# 不许直接 import 任何其它子包 —— 那些是 guts。
#
# 判定:凡是**已采用 facade 约定的域**(存在 internal/<domain>/facade/ 目录),域外每一处
# import internal/<domain>/<sub> 里 <sub> != facade 即违纪。域自己建了 facade/ 就自动进入执法集,
# 不用维护名单 —— 重构推进到哪个域,执法就长到哪个域。
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERNAL="$ROOT/backend/internal"

scan() {
  local internal="$1"
  python3 - "$internal" <<'PY'
import os, re, sys
internal = sys.argv[1]
# 已采用 facade 约定的域 = 存在 internal/<domain>/facade/ 子目录的域。
domains = sorted(
    d for d in os.listdir(internal)
    if os.path.isdir(os.path.join(internal, d, "facade"))
)
imp_re = re.compile(r'atmaxmoj/standmeet/internal/([a-z0-9_]+)/([a-z0-9_]+)')
violations = []
for d in domains:
    domain_root = os.path.join(internal, d) + os.sep
    for dirpath, _, files in os.walk(internal):
        # 域内部引用自己的子包合法(facade 就住这儿,facade 也要 import guts)。
        if (dirpath + os.sep).startswith(domain_root):
            continue
        for fn in files:
            if not fn.endswith(".go"):
                continue
            path = os.path.join(dirpath, fn)
            for line in open(path):
                for dom, sub in imp_re.findall(line):
                    if dom == d and sub != "facade":
                        rel = os.path.relpath(path, internal)
                        violations.append(f"{rel}\t{d}/{sub}")
for v in sorted(set(violations)):
    print(v)
PY
}

hits="$(scan "$INTERNAL")"
if [ -n "$hits" ]; then
  echo "check-domain-facade-boundary: 域外代码绕过 facade 直接 import 了某域的 guts 子包:"
  echo "$hits" | while IFS=$'\t' read -r f gut; do
    echo "  $f  -> internal/$gut  (必须改走 .../facade)"
  done
  exit 1
fi

# self-test: 植入一个域外文件直接 import security 的 guts(ban),断言被抓,再清理。
TMPDIR="$INTERNAL/__facade_boundary_selftest__"
mkdir -p "$TMPDIR"
cat > "$TMPDIR/leak.go" <<'GO'
package selftest

import _ "github.com/atmaxmoj/standmeet/internal/security/ban"
GO
planted="$(scan "$INTERNAL")"
rm -rf "$TMPDIR"
if [ -z "$planted" ]; then
  echo "check-domain-facade-boundary: self-test FAILED —— 植入的越界 import 没被抓到。"
  exit 1
fi

enforced="$(python3 -c "import os;print(len([d for d in os.listdir('$INTERNAL') if os.path.isdir(os.path.join('$INTERNAL',d,'facade'))]))")"
echo "check-domain-facade-boundary: $enforced 个域已建 facade,域外只经 .../facade 访问 (self-test 通过)。"
