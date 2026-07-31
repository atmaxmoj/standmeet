#!/usr/bin/env bash
# check-routes-via-dispatcher-test —— 自检：种一个新的违规文件，闸门必须变红。
#
# 一个从没红过的闸门不是闸门。这里种的正是它要拦的东西：一个 internal/routes 下的**新**文件
# （不在基线里）直接 import 域的 facade —— 也就是绕过出站收口自己够到域。
#
# 种 → 期望红 → 删。种的文件不参与编译（种完就删），也不会留在树上。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../backend" && pwd)"
PLANT="$ROOT/internal/routes/admin/zz_dispatcher_gate_selftest.go"

cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT

cat > "$PLANT" <<'EOF'
// 自检用的种植文件，由 check-routes-via-dispatcher-test.sh 生成并立即删除。
package admin

import security "github.com/atmaxmoj/standmeet/internal/security/facade"

var _ *security.BannedIPRepo
EOF

tool="$(mktemp)"
( cd "$(dirname "$0")/check-routes-via-dispatcher" && go build -o "$tool" . )

set +e
out="$( cd "$ROOT" && "$tool" 2>&1 )"
rc=$?
set -e
rm -f "$tool"

if [ "$rc" -eq 0 ]; then
  echo "check-routes-via-dispatcher: SELF-TEST FAILED — 种了一个绕过收口的新文件，闸门却是绿的。"
  echo "$out"
  exit 1
fi

if ! grep -q "zz_dispatcher_gate_selftest.go" <<<"$out"; then
  echo "check-routes-via-dispatcher: SELF-TEST FAILED — 闸门红了，但报的不是种下的那个文件。"
  echo "$out"
  exit 1
fi

echo "check-routes-via-dispatcher: self-test passed (a planted domain-facade import goes red)."
