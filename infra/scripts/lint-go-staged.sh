#!/usr/bin/env bash
# lint-go-staged.sh — the FAST pre-commit gate for backend Go: run golangci-lint only on the
# PACKAGES that hold the staged Go files, not the whole module.
#
# Why: the whole-module `make backend-lint` (golangci over every package + arch + build + ~25
# guards) takes ~230s, too slow to pay on every commit. The commit gate must still exist (a commit
# is not nothing), but it only needs to catch obvious problems in what THIS commit changed. The full
# unscoped chain runs on pre-push (`make lint-cached`), which is the real gate before code leaves the
# machine. So: commit = golangci on staged packages (seconds); push = everything.
#
# Args are the staged Go file paths, repo-relative (backend/internal/foo.go), passed by lefthook's
# {staged_files}. We map them to their package directories, dedupe, drop any whose directory no
# longer exists (a staged deletion), and hand golangci the surviving package dirs. golangci lints a
# whole package given any file/dir in it — narrower than `./...`, wide enough to catch real issues.
#
# Portable to macOS's bash 3.2 (no associative arrays / mapfile): dedupe via `sort -u`, and the
# unquoted `$dirs` word-split is intentional — package paths carry no spaces.
set -euo pipefail

[ "$#" -gt 0 ] || exit 0

cd "$(dirname "$0")/../../backend"

dirs=$(
  for f in "$@"; do
    f="${f#backend/}" # strip the repo-relative prefix → path within the backend module
    d="./$(dirname "$f")"
    [ -d "$d" ] && printf '%s\n' "$d" # skip a staged deletion whose package dir is gone
  done | sort -u
)

[ -n "$dirs" ] || exit 0 # only non-Go backend files staged (a manifest, a baseline) → nothing to lint

echo "golangci-lint (staged packages):" $dirs
# shellcheck disable=SC2086 # intentional word-split: $dirs is a newline list of space-free paths
exec golangci-lint run $dirs
