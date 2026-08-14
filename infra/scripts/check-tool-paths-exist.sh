#!/usr/bin/env sh
# check-tool-paths-exist —— **工具描述里点名的 admin 路径必须真的存在。**
#
# 为什么这条闸门存在：
# 那些 description 不是注释，它们是**发给 owner 的 AI 的说明书**。`resume.draft` 的原话是
# *"Owner opens admin preview at /admin/drafts/<id>"* —— 而那个 URL 是 404（真实路由是
# `/admin/drafts`，然后点 OPEN COMPOSER）。owner 的 AI 会照抄这句话，把人送到一个死链接上，
# 而**没有任何东西会报错**：Go 那边是字符串，Next 那边是文件系统路由，两边谁也不认识谁。
#
# 判据是「那一段 URL 能不能落到 app router 上」，不是「有没有写 URL」——
# 见 [[ref-resolves-not-a-string]]：闸门查「写没写」而不是「指得到吗」，就等于没查。
#
# 动态段按 Next 的写法折算：`/admin/x/<id>` 认 `app/admin/x/[…]/page.tsx`。
#
# 自证：种一条指向不存在页面的描述，判定必须看得见。

set -eu

fail=0
ROUTES_DIR=app/src/app

# route_exists —— 一个 /admin/... 路径在 app router 里有没有对应的 page.tsx。
# 逐段走：字面段要么有同名目录，要么有一个 [dyn] 目录；<x> / {x} / :x 只能落在 [dyn] 上。
route_exists() {
  dir="$ROUTES_DIR"
  path=$(printf '%s' "$1" | sed 's#^/##; s#/$##')
  for seg in $(printf '%s' "$path" | tr '/' ' '); do
    case "$seg" in
      '<'*|'{'*|':'*)
        dyn=$(find "$dir" -maxdepth 1 -name '\[*\]' -type d 2>/dev/null | head -1)
        [ -n "$dyn" ] || return 1
        dir="$dyn"
        ;;
      *)
        if [ -d "$dir/$seg" ]; then
          dir="$dir/$seg"
        else
          dyn=$(find "$dir" -maxdepth 1 -name '\[*\]' -type d 2>/dev/null | head -1)
          [ -n "$dyn" ] || return 1
          dir="$dyn"
        fi
        ;;
    esac
  done
  [ -f "$dir/page.tsx" ]
}

# 范围按「**声明了工具的文件**」定，不按目录：按目录会把 HTTP API 路径（`/api/admin/…` 的尾巴）
# 一起扫进来，那是另一回事，误伤会让这道闸被关掉（见 [[gate-scope-forces-architecture]]）。
# 工具有两种声明形态，都要认 —— 只认一种的话，第一个促成这道闸的文件恰好在盲区里
# （jobs 的工具走 capreg.MCPBinding，见 [[gate-can-go-blind]]）。
tool_files=$(grep -rl -e 'fp\.Op{' -e 'capreg\.MCPBinding{' backend/internal \
  --include='*.go' 2>/dev/null | grep -v '_test\.go' || true)

# 三处收窄，每一处都是第一版误伤过的：
#   1. 去掉 Go 注释行 —— 判据是「**工具对 AI 说了什么**」，注释不是。（讲清这条缺陷的注释
#      里必然写着那个坏 URL，把它算进来的话，修完仍然红。）
#   2. `/api` 前缀连着匹配再滤掉 —— `/api/admin/api-keys` 是 HTTP 路由不是页面，
#      只匹配 `/admin/…` 会从它中间截一段。
#   3. 尾随标点剥掉。
paths=$(printf '%s\n' "$tool_files" | xargs -r grep -hE '(/api)?/admin/' \
  | grep -vE '^[[:space:]]*//' \
  | grep -oE '(/api)?/admin/[A-Za-z0-9_/<>{}:-]+' \
  | grep -v '^/api/' | tr -d '.,)"`' | sort -u || true)

for p in $paths; do
  if ! route_exists "$p"; then
    echo "check-tool-paths-exist: a tool description sends the owner to $p — no such page."
    fail=1
  fi
done

# 扫描范围自证之一：没有取到任何路径的话，上面那个循环恒绿。
n=$(printf '%s\n' "$paths" | grep -c . || true)
if [ "$n" -lt 1 ]; then
  echo "check-tool-paths-exist: SELF-TEST FAILED — no /admin path found in any tool description,"
  echo "                        the scan is blind (grep range or quoting changed?)"
  exit 2
fi

# 扫描范围自证之二：**两种声明形态都得在范围里**。只剩一种时上面那条计数照样过，
# 而另一整类工具的描述从此没人看 —— 这道闸第一次跑就差点这么瞎掉。
for marker in 'fp\.Op{' 'capreg\.MCPBinding{'; do
  hits=$(printf '%s\n' "$tool_files" | xargs -r grep -l "$marker" 2>/dev/null | grep -c . || true)
  if [ "$hits" -lt 1 ]; then
    echo "check-tool-paths-exist: SELF-TEST FAILED — no file matched $marker; that whole"
    echo "                        family of tool declarations is outside the scan"
    exit 2
  fi
done

# 判定自证：一个**确定不存在**的路径必须被判为不存在。
if route_exists "/admin/definitely-not-a-page"; then
  echo "check-tool-paths-exist: SELF-TEST FAILED — a nonexistent route was judged to exist"
  exit 2
fi
# 反向自证：一个**确定存在**的路径必须被判为存在，否则这道闸会把所有人都判红并被关掉。
if ! route_exists "/admin/drafts"; then
  echo "check-tool-paths-exist: SELF-TEST FAILED — /admin/drafts exists but was judged missing"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-tool-paths-exist: $n admin path(s) named in tool descriptions, all resolve (self-test passed)."
