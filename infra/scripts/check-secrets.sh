#!/usr/bin/env sh
# check-secrets —— **no secret leaves this machine.**
#
# Why it's shaped this way: the repo already had a gitleaks step (`secrets` in `backend/Makefile`),
# and it couldn't block the two exits for this —
#
#   1. **Silent pass when gitleaks is absent**: `command -v gitleaks || exit 0` prints one "skipping"
#      line and reports success. On a machine without it, this step signs off on work it never did.
#   2. **Scans only the staging area** (`gitleaks protect --staged`). But `git push` sends out the
#      **entire history**: a secret deleted in a later commit is still pushed. The staging area never
#      sees it.
#
# So this scans **history**, and goes **red** when gitleaks is absent, not skip.
#
# The image exit isn't here: what's in the image is decided by `.dockerignore`, a different list from
# `.gitignore`. That one is handled by `make secrets-image` scanning **the image itself** (not its
# build context — the context is a stand-in).
#
# Self-test: plant a real secret in **the directory with the densest allowlist entries**, and the
# judgment must see it. The allowlist is the one place this gate can go blind, and when it does it
# looks identical to passing — this self-test caught it on its first run: the config had
# `paths = ['docs/design/project/']`, meant as "the four fake tokens in this directory", while
# gitleaks' actual behavior is **skip the whole directory** (`scanned ~0 bytes`). The planted AWS key
# just lay there, unseen. So the config now has no `paths` at all.

set -eu

CONFIG=".gitleaks.toml"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "check-secrets: gitleaks is not installed — this gate cannot run."
  echo "               install it (brew install gitleaks) rather than skipping:"
  echo "               a skipped secret scan reports success for work it did not do."
  exit 2
fi

test -f "$CONFIG" || { echo "check-secrets: $CONFIG missing"; exit 2; }

# ── Self-test ────────────────────────────────────────────────────────────────────────────────
# Plant in docs/design/project/ —— the directory with the most allowlist entries (the design
# prototype's four fake tokens). The planted value has nothing to do with those four: what's
# allowlisted is those four exact literals, not this directory, nor "things that look like a token".
#
# The canary does not use the `…EXAMPLEKEY` from the AWS docs: gitleaks' default config **already
# allowlists** all public example keys, so it would prove nothing — a self-test that can never go red
# is the same as no self-test.
#
# The canary also **cannot be a constant in this file**: that would make it a secret-shaped string
# committed to the repo, and the only way to get it past the gate would be to allowlist it — a
# permanent secret-shaped hole. This gate went red here on its first run (red at its own canary),
# so it now generates a fresh one each time, with no secret-shaped constant in the file.
PLANT="docs/design/project/.gitleaks-selftest-canary.txt"
cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT INT TERM
# **The canary must hit a rule that ignores entropy.**
#
# The first two versions used `aws_secret_access_key = "<random string>"`, hitting gitleaks'
# `generic-api-key` — that rule **has an entropy threshold**, so part of a random string always falls
# below it: measured 1 miss in 40 (that one also ran short, because `tr -d '/+='` deletes characters),
# and even at a fixed 40 chars it was 3 misses in 60.
# The consequence is this gate **randomly** reports "the allowlist is blind" and blocks a normal
# commit — and a flaky self-test is worse than none: it trains people to retry, and retrying is
# exactly the action it means to stop.
#
# The private-key rule looks only at **block structure**, not entropy. Measured 0 misses in 60.
# The marker header is assembled from `-----%s RSA PRIVATE KEY-----`: this way there's no literal in
# this file that could be scanned by itself, so no secret-shaped allowlist entry is needed for it.
canary_body=$(LC_ALL=C tr -dc 'A-Za-z0-9+/' < /dev/urandom | head -c 64)
printf -- '-----%s RSA PRIVATE KEY-----\n%s\n-----%s RSA PRIVATE KEY-----\n' \
  BEGIN "$canary_body" END > "$PLANT"
if gitleaks dir docs/design/project --config "$CONFIG" --no-banner --redact >/dev/null 2>&1; then
  echo "check-secrets: SELF-TEST FAILED — a planted AWS key inside an allowlisted"
  echo "               directory was not detected. The allowlist has gone blind."
  exit 2
fi
cleanup
trap - EXIT INT TERM

# ── Real scan: staging area ─────────────────────────────────────────────────────────────────────────
# The change not yet committed. The history scan can't see it — it isn't history yet.
if ! gitleaks git --staged . --config "$CONFIG" --no-banner --redact; then
  echo "check-secrets: secrets in the staged diff — do NOT commit."
  exit 1
fi

# ── Real scan: history ───────────────────────────────────────────────────────────────────────────
# `git push` sends out the entire history. A secret deleted in a later commit is still pushed.
if ! gitleaks git . --config "$CONFIG" --no-banner --redact; then
  echo "check-secrets: secrets found in history. Do NOT push."
  echo "               A secret removed in a later commit is still in the history you push;"
  echo "               rotate it first, then rewrite history — deleting the file is not enough."
  exit 1
fi

commits=$(git rev-list --count HEAD)
echo "check-secrets: staged diff + ${commits} commits of history scanned, clean"
echo "               (self-test passed: a planted key in the allowlisted directory goes red)."
