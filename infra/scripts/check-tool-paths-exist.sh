#!/usr/bin/env sh
# check-tool-paths-exist —— **an admin path named in a tool description must really exist.**
#
# Why this gate exists:
# Those descriptions aren't comments, they are **the manual handed to the owner's AI**. `resume.draft`
# literally says *"Owner opens admin preview at /admin/drafts/<id>"* — and that URL is a 404 (the real
# route is `/admin/drafts`, then click OPEN COMPOSER). The owner's AI copies this line verbatim and
# sends the person to a dead link, and **nothing errors**: Go's side is a string, Next's side is a
# filesystem route, and neither knows the other.
#
# The criterion is "does that URL segment land on the app router", not "was a URL written" —
# see [[ref-resolves-not-a-string]]: a gate that checks "was it written" rather than "does it resolve"
# has checked nothing.
#
# Dynamic segments map to Next's convention: `/admin/x/<id>` matches `app/admin/x/[…]/page.tsx`.
#
# Self-test: plant a description pointing at a nonexistent page, and the judgment must see it.

set -eu

fail=0
ROUTES_DIR=app/src/app

# route_exists —— whether a /admin/... path has a matching page.tsx in the app router.
# Walk segment by segment: a literal segment needs either a same-name directory or a [dyn] directory;
# <x> / {x} / :x can only land on a [dyn].
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

# The scope is defined by "**files that declare a tool**", not by directory: by directory it would
# also scan HTTP API paths (the tails of `/api/admin/…`), which is a different matter, and the
# false positives would get this gate turned off (see [[gate-scope-forces-architecture]]).
# Tools have two declaration forms, both must be recognized — recognize only one and the very file
# that prompted this gate sits in the blind spot (jobs' tools go through capreg.MCPBinding, see
# [[gate-can-go-blind]]).
tool_files=$(grep -rl -e 'fp\.Op{' -e 'capreg\.MCPBinding{' backend/internal \
  --include='*.go' 2>/dev/null | grep -v '_test\.go' || true)

# Three narrowings, each a false positive from the first version:
#   1. Drop Go comment lines — the criterion is "**what the tool tells the AI**", not comments. (The
#      comment explaining this very defect necessarily contains that bad URL; count it in and the fix
#      stays red.)
#   2. Match the `/api` prefix along and then filter it out — `/api/admin/api-keys` is an HTTP route,
#      not a page, and matching only `/admin/…` would cut a segment out of its middle.
#   3. Strip trailing punctuation.
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

# Scan-range self-test one: if no path was captured, the loop above is always green.
n=$(printf '%s\n' "$paths" | grep -c . || true)
if [ "$n" -lt 1 ]; then
  echo "check-tool-paths-exist: SELF-TEST FAILED — no /admin path found in any tool description,"
  echo "                        the scan is blind (grep range or quoting changed?)"
  exit 2
fi

# Scan-range self-test two: **both declaration forms must be in range**. With only one left, the
# count above still passes, while a whole other class of tool descriptions goes unread — this gate
# nearly went blind this way on its first run.
for marker in 'fp\.Op{' 'capreg\.MCPBinding{'; do
  hits=$(printf '%s\n' "$tool_files" | xargs -r grep -l "$marker" 2>/dev/null | grep -c . || true)
  if [ "$hits" -lt 1 ]; then
    echo "check-tool-paths-exist: SELF-TEST FAILED — no file matched $marker; that whole"
    echo "                        family of tool declarations is outside the scan"
    exit 2
  fi
done

# Judgment self-test: a path that **definitely does not exist** must be judged nonexistent.
if route_exists "/admin/definitely-not-a-page"; then
  echo "check-tool-paths-exist: SELF-TEST FAILED — a nonexistent route was judged to exist"
  exit 2
fi
# Reverse self-test: a path that **definitely exists** must be judged to exist, or this gate would flag everyone red and get turned off.
if ! route_exists "/admin/drafts"; then
  echo "check-tool-paths-exist: SELF-TEST FAILED — /admin/drafts exists but was judged missing"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-tool-paths-exist: $n admin path(s) named in tool descriptions, all resolve (self-test passed)."
