#!/usr/bin/env sh
# check-no-native-file-input —— 选文件的按钮必须是这个产品画的，不是操作系统画的。
#
# 为什么这条闸门存在（UX-81）：`<input type="file">` 会自己画一个 `Choose File / No file chosen`。
# 它的长相由**操作系统**决定 —— 跟奶油纸 + 朱红 + mono 那套语言毫无关系。在连接器弹窗里它是
# 整扇窗唯一没被设计过的控件，就贴在被设计过的按钮旁边。
#
# 真正的账在后面：修完那一处之后，同样的东西还站在另外两个地方（wiki 条目的 FILES 行、
# writing 的封面图）—— **一条教训只修了发现它的那一处**（[[lesson-not-swept-to-neighbours]]）。
# 所以这里锁的不是「记得把它藏起来」，而是「藏不起来就写不出来」：
# 唯一的写法是 FilePicker atom（[[structure-means-no-responsibility-class]]）。
#
# **判定的形状**：`type="file"` 那一行往后 6 行内，必须出现 `sr-only` 或 `className="hidden"`。
# 视觉上藏起来的原生 input 是**正当写法** —— ObsidianBar 的 vault 目录选择就是这样：input 藏着，
# 旁边站一个真正的 Btn。这条规矩管的是**看得见的原生控件**，不是「必须用某个组件」。
# 划在「看不看得见」而不是「是不是 FilePicker」，是为了不把 webkitdirectory 那种正当用法逼去
# 更糟的地方（[[gate-scope-forces-architecture]]）。
#
# 自证：种一个裸的必须判红；种一个 sr-only 的和一个 className="hidden" 的都必须放过。

set -eu

OWNER="app/src/components/admin/atoms/FilePicker.tsx"
WINDOW=6

fail=0

# scan_native —— 找「看得见的原生 file input」。注释行跳过：几个文件的顶部注释正在讲这段历史，
# 把它们判红会逼人删掉解释。
scan_native() {
  awk -v w="$WINDOW" '
    /^[[:space:]]*(\/\/|\*|\/\*|\{\/\*|#)/ { next }
    { buf[FNR] = $0 }
    /type="file"/ { hit[FNR] = 1 }
    END {
      for (k in hit) {
        # k 是数组下标 —— awk 给的是**字符串**。不 +0 的话 `"6" <= 12` 走字符串比较（"6" > "12"），
        # 窗口整个不展开，藏好的 input 也会被判红。自证就是这么抓到的。
        n = k + 0
        hidden = 0
        for (i = n; i <= n + w; i++) {
          if (buf[i] ~ /sr-only/ || buf[i] ~ /className="hidden"/) { hidden = 1 }
        }
        if (!hidden) { print FILENAME ":" n ":" buf[n] }
      }
    }
  ' "$1"
}

scan_all() {
  for f in "$@"; do scan_native "$f"; done
}

files=$(find app/src sdk -name '*.tsx' -type f 2>/dev/null | grep -v node_modules || true)

# 1) 扫描器必须真的看得见文件 —— 空列表会让下面的判定恒绿（[[assertion-that-cannot-fail]]，
#    以及 alpine 上 grep --include 静默失明那次 [[gate-can-go-blind]]）。
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-no-native-file-input: SELF-TEST FAILED — only $n tsx files found, the scan is blind"
  exit 2
fi

# shellcheck disable=SC2086  # $files 是换行分隔的路径列表，这里要的就是词分割
offenders=$(scan_all $files || true)

if [ -n "$offenders" ]; then
  echo "check-no-native-file-input: 浏览器自己画的 Choose File 会出现在这些地方 ——"
  echo "$offenders"
  echo "                            用 <FilePicker label=… testid=… onPick=…> ($OWNER)，"
  echo "                            或者把 input 藏起来（sr-only / hidden）再自己画按钮。"
  fail=1
fi

# 2) atom 必须还在，而且它自己确实是藏着的 —— 否则上面那条等于没有落点。
if [ ! -f "$OWNER" ]; then
  echo "check-no-native-file-input: $OWNER is gone; the rule has no owner"
  fail=1
elif ! grep -q 'sr-only' "$OWNER"; then
  echo "check-no-native-file-input: $OWNER 不再把 input 藏起来 —— 这条规矩的唯一正解失效了"
  fail=1
fi

# 3) 自证：一红两绿。只验红的闸门没验过自己的边界。
guilty=$(mktemp -t filecheck.XXXXXX)
cat > "$guilty" <<'PLANTED'
export function Bad() {
  return <input type="file" accept="image/*" className="mono text-[11px]" />;
}
PLANTED
innocent=$(mktemp -t filecheck.XXXXXX)
cat > "$innocent" <<'PLANTED'
export function Hidden() {
  return (
    <label className="sm-btn">
      pick
      <input
        type="file"
        accept=".json"
        className="sr-only"
      />
    </label>
  );
}
export function AlsoHidden({ inputRef }) {
  return <input ref={inputRef} type="file" multiple className="hidden" />;
}
PLANTED
guilty_hits=$(scan_native "$guilty" | grep -c . || true)
innocent_hits=$(scan_native "$innocent" | grep -c . || true)
rm -f "$guilty" "$innocent"
if [ "$guilty_hits" -ne 1 ]; then
  echo "check-no-native-file-input: SELF-TEST FAILED — expected 1 planted offender, saw $guilty_hits"
  exit 2
fi
if [ "$innocent_hits" -ne 0 ]; then
  echo "check-no-native-file-input: SELF-TEST FAILED — a visually hidden input must be let through, saw $innocent_hits"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-no-native-file-input: every file picker is one this product drew ($n tsx files scanned; self-test passed)."
