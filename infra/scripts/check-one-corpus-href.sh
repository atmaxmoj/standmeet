#!/usr/bin/env sh
# check-one-corpus-href —— a corpus entry's public address must have **one source**.
#
# Why this gate exists: this used to have no owner — 15 places each hand-built `/wiki/…` `/writings/…`
# `/output/…`, and they disagreed with each other — some used slug, some used path, two wrote
# `/${genre}/${path}` directly. That last shape rendered a 404 in prod:
#   sijie.xyz/writing/writings/the-business-model-wedge
# It **used the genre name as the route name** (genre is singular `writing`, the route is plural
# `/writings/[slug]`), and that writing's corpus path already carried a `writings/` prefix, so the
# two stacked. That entry was the instance's **only** public writing at the time — meaning the entire
# public-reading entry point was broken.
#
# A layer deeper: `public.ts`'s `mapWritingNode` packs the slug into the `path` field, so the same
# `TreeNode.path` means slug from the tree interface and the real path from the reference lookup.
# **The same field name, two meanings** — that's exactly why the same expression is right on one
# screen and 404s on another. Renaming makes each place's independent decision "look" consistent,
# when they were never consistent to begin with.
#
# What's locked down is **structure**, not a string: what rots isn't one typo, it's "anyone can build
# their own". The only place allowed to do this is `app/src/lib/corpus/href.ts` (the single home for
# the mapping and the addressing identifier).
#
# Self-test: feed a planted bad pattern to the same check — it must go red; if it doesn't, the scanner
# is blind (see [[gate-can-go-blind]]).

set -eu

# Only scan the **presentation layer** (`components/` + `app/`).
#
# The first version scanned all of `app/src`, so it also flagged `lib/admin/use-writings.ts`'s
# `adminAPI.patchForm('/writings/${id}')` — that's a **backend route** under `/api/admin`, a
# different namespace from public-page addresses; sharing the name is coincidence. A gate scoped too
# wide forces legitimate code to route around it (see [[gate-scope-forces-architecture]]).
#
# The boundary is real: public-page addresses are built in the presentation layer (href / Link), the
# data-access layer builds API paths.
SRC="app/src/components app/src/app"
HOME_FILE="app/src/lib/corpus/href.ts"

fail=0

# 1) The home file must exist. If it doesn't, every import below is a dangling reference, and the gate would go all-green because "nobody's violating it".
if [ ! -f "$HOME_FILE" ]; then
  echo "check-one-corpus-href: $HOME_FILE is missing — the mapping has no home"
  exit 1
fi

# scan —— finds **hand-built** public corpus addresses in tsx/ts: a template string or literal
# starting with /wiki/ /writings/ /output/. Takes filenames on stdin, prints any hit.
#
# Looking only at href/Link usages would miss cases (someone computes it into a variable first, then
# passes it), so what's judged is the shape itself: **these three prefixes appearing inside a
# concatenated string**.
# drop_comments —— a comment mentioning the old pattern is **explanation**, not a violation. The first
# version flagged the very comment explaining this bug: if a gate won't even allow "talking about it",
# the right fix can never get written down.
drop_comments() {
  grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' || true
}

scan() {
  grep -nE "(\`|')/(wiki|writings|output)/\\\$\{" "$@" 2>/dev/null | drop_comments
}

offenders=$(find $SRC \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
  | xargs -0 -r grep -nE "(\`|')/(wiki|writings|output)/\\\$\{" 2>/dev/null | drop_comments)

if [ -n "$offenders" ]; then
  echo "check-one-corpus-href: a corpus URL is hand-built instead of going through corpusHref():"
  echo "$offenders"
  echo "  → import { corpusHref } from '@/lib/corpus/href'"
  echo "     wiki/output address by path, writings by slug — that split lives only inside href.ts."
  fail=1
fi

# 2) `/${genre}/…` —— the kind that treats the genre name as the route name, a different shape from
#    above, scanned separately. It's the direct cause of that 404, and it's **the one that looks most
#    right**: two of the three genres happen to work out.
genre_join=$(find $SRC \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
  | xargs -0 -r grep -nE '\`/\$\{[a-zA-Z_.]*genre[a-zA-Z_.]*\}/' 2>/dev/null | drop_comments)

if [ -n "$genre_join" ]; then
  echo "check-one-corpus-href: a URL is built from a genre string — the genre is NOT the route:"
  echo "$genre_join"
  echo "  → writing → /writings (singular genre, plural route). This mapping lives only inside href.ts."
  fail=1
fi

# 3) Self-test: plant a bad pattern, the same check must be able to see it.
planted=$(mktemp -t corpushref.XXXXXX)
mv "$planted" "$planted.tsx"
planted="$planted.tsx"
cat > "$planted" <<'PLANTED'
export function Planted({ node }: { node: { path: string } }) {
  return <a href={`/wiki/${node.path}`}>planted</a>;
}
PLANTED
if [ -z "$(scan "$planted")" ]; then
  rm -f "$planted"
  echo "check-one-corpus-href: SELF-TEST FAILED — the scan cannot see a planted hand-built URL"
  exit 2
fi
rm -f "$planted"

[ "$fail" -eq 0 ] || exit 1
echo "check-one-corpus-href: one corpus-href source (self-test passed: a planted hand-built URL goes red)."
