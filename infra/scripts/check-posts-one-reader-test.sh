#!/usr/bin/env bash
# check-posts-one-reader-test —— the gate stays green on a tree whose posts reads live in the posts
# package, and goes red on each of the three planted second readers.

set -eu

GATE="$(cd "$(dirname "$0")" && pwd)/check-posts-one-reader.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/backend/internal/corpus/posts/db" "$tmp/backend/internal/corpus/usecase" \
  "$tmp/backend/db/queries/posts" "$tmp/backend/db/queries/corpus"
cat > "$tmp/backend/internal/corpus/posts/index.go" <<'EOF'
package posts
import _ "github.com/atmaxmoj/standmeet/internal/corpus/posts/db"
var d = search.Doc{Genre: "post", URI: "post://x"}
EOF
echo '-- name: ListPosts :many
SELECT * FROM posts WHERE owner_id = $1;' > "$tmp/backend/db/queries/posts/posts.sql"
echo '-- name: ListNotes :many
SELECT * FROM corpus_notes, posts_archive_x WHERE false;' > "$tmp/backend/db/queries/corpus/notes.sql"
echo 'package usecase
var d = search.Doc{Genre: "wiki"}' > "$tmp/backend/internal/corpus/usecase/index.go"

if ! ROOT="$tmp" bash "$GATE" >/dev/null; then
  echo "check-posts-one-reader self-test: FAILED — the clean tree went red"
  exit 1
fi

expect_red() {
  if ROOT="$tmp" bash "$GATE" >/dev/null; then
    echo "check-posts-one-reader self-test: FAILED — $1 stayed green"
    exit 1
  fi
  rm -f "$2"
}

f="$tmp/backend/internal/corpus/usecase/leak_import.go"
echo 'package usecase
import pdb "github.com/atmaxmoj/standmeet/internal/corpus/posts/db"' > "$f"
expect_red "a posts repo import outside the package" "$f"

f="$tmp/backend/db/queries/corpus/leak.sql"
echo '-- name: Recent :many
SELECT body FROM corpus_notes n JOIN posts p ON p.owner_id = n.owner_id;' > "$f"
expect_red "an sqlc query joining posts outside the posts dir" "$f"

f="$tmp/backend/internal/corpus/usecase/leak_index.go"
echo 'package usecase
var d = search.Doc{Genre: "post", Body: b}' > "$f"
expect_red "a post search document outside the package" "$f"

echo "check-posts-one-reader: self-test passed (an import, a query and an index write outside the package each go red)."
