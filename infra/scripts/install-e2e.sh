#!/usr/bin/env bash
# install-e2e.sh —— a new owner's first install, driven end to end on a clean host.
#
# The "host" is a docker-in-docker container with nothing on it but Docker. The installer runs
# inside it exactly as a new owner runs it (with --domain, so Caddy terminates TLS), pulling the
# released images. From outside, the test then does what the owner does next, over HTTPS through
# that Caddy: open the claim link, claim, sign in, open the public page. It also re-runs the
# installer and checks that the secrets were kept, not regenerated.
#
# Usage: make install-e2e          (keeps an image cache volume between runs; data is dropped)
#
# ponytail: checks run with curl against the real HTTPS endpoint, not a browser — the subject is
# "does a fresh host come up and accept its owner", which curl answers; the UI has its own suites.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST=sm-install-host
DOMAIN=standmeet.test
PORT=18443
PLAIN_PORT=13000
CACHE=sm-install-dind-cache
OUT="${INSTALL_E2E_OUT:-$ROOT/e2e/test-results/install-e2e}"
mkdir -p "$OUT"

fail() { echo "INSTALL-E2E FAIL: $*" >&2; exit 1; }
cleanup() {
  docker exec "$HOST" sh -c 'cd /root/standmeet 2>/dev/null && docker compose down -v >/dev/null 2>&1' || true
  docker rm -f "$HOST" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The host: Docker and nothing else (plus bash/curl/openssl, which any server image has).
docker rm -f "$HOST" >/dev/null 2>&1 || true
docker run -d --privileged --name "$HOST" -p "$PORT:443" -p "$PLAIN_PORT:3000" -v "$CACHE:/var/lib/docker" docker:27-dind >/dev/null
for _ in $(seq 1 60); do docker exec "$HOST" docker info >/dev/null 2>&1 && break; sleep 1; done
docker exec "$HOST" docker info >/dev/null 2>&1 || fail "dockerd never came up on the test host"
docker exec "$HOST" apk add --no-cache bash curl openssl >/dev/null

# What a new owner downloads: the installer and the deploy files, nothing else from the repo.
docker exec "$HOST" mkdir -p /opt/standmeet-src
docker cp "$ROOT/infra/scripts/install.sh" "$HOST:/opt/standmeet-src/install.sh"
for f in "$ROOT"/infra/deploy/*.yml; do docker cp "$f" "$HOST:/opt/standmeet-src/"; done

run_install() {
  docker exec -e STANDMEET_SOURCE=/opt/standmeet-src "$HOST" \
    bash /opt/standmeet-src/install.sh --domain "$DOMAIN" --internal-certs
}

echo "[install-e2e] first install ..."
run_install | tee "$OUT/install-1.log"
CLAIM=$(grep -oE "https://$DOMAIN/setup\?t=[A-Za-z0-9_-]+" "$OUT/install-1.log" | tail -1)
[ -n "$CLAIM" ] || fail "the installer did not print a claim link"
TOKEN=${CLAIM##*t=}

ENV_BEFORE=$(docker exec "$HOST" sha256sum /root/standmeet/.env)

# From outside, over HTTPS through the bundled Caddy (its local CA: -k).
CURL=(curl -sk --resolve "$DOMAIN:$PORT:127.0.0.1" -o /dev/null -w '%{http_code}')
BASE="https://$DOMAIN:$PORT"

code=$("${CURL[@]}" "$BASE/setup?t=$TOKEN")
[ "$code" = 200 ] || fail "claim page answered $code over HTTPS"

# No Turnstile is configured on a fresh install, so sign-in accepts any captcha value.
CAPTCHA_HEADER=X-Captcha-Token
NO_CAPTCHA=(-H "$CAPTCHA_HEADER: none")
EMAIL=owner@standmeet.test
PASS=install-e2e-password-1234
code=$("${CURL[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/admin/claim" \
  -d "{\"token\":\"$TOKEN\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"handle\":\"owner\",\"full_name\":\"New Owner\",\"public_url\":\"https://$DOMAIN\"}")
[ "$code" = 200 ] || fail "claim answered $code"

code=$("${CURL[@]}" -H 'Content-Type: application/json' "${NO_CAPTCHA[@]}" \
  -X POST "$BASE/api/admin/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
[ "$code" = 200 ] || fail "the owner could not sign in after claiming ($code)"

code=$("${CURL[@]}" "$BASE/")
[ "$code" = 200 ] || fail "the public page answered $code"

TABLES=$(docker exec "$HOST" sh -c 'cd /root/standmeet && docker compose exec -T db psql -U standmeet -d standmeet -Atc "select count(*) from information_schema.tables where table_name in ('"'corpus_notes','owners','access_codes'"')"')
[ "$TABLES" = 3 ] || fail "schema missing on the fresh database (found $TABLES of 3 tables)"

echo "[install-e2e] re-run ..."
run_install | tee "$OUT/install-2.log"
ENV_AFTER=$(docker exec "$HOST" sha256sum /root/standmeet/.env)
[ "$ENV_BEFORE" = "$ENV_AFTER" ] || fail "re-running the installer changed .env — secrets must never be regenerated"
code=$(curl -sk --resolve "$DOMAIN:$PORT:127.0.0.1" -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' "${NO_CAPTCHA[@]}" \
  -X POST "$BASE/api/admin/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
[ "$code" = 200 ] || fail "after a re-run the owner can no longer sign in ($code)"

# Without --domain: a clean install whose app is on a host port, for the owner's own proxy.
echo "[install-e2e] no-domain install on a wiped host ..."
docker exec "$HOST" sh -c 'cd /root/standmeet && docker compose down -v >/dev/null 2>&1; rm -rf /root/standmeet'
docker exec -e STANDMEET_SOURCE=/opt/standmeet-src "$HOST" bash /opt/standmeet-src/install.sh \
  | tee "$OUT/install-plain.log"
PATH_ONLY=$(grep -oE "/setup\?t=[A-Za-z0-9_-]+" "$OUT/install-plain.log" | tail -1)
[ -n "$PATH_ONLY" ] || fail "the no-domain install did not print a claim link"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PLAIN_PORT$PATH_ONLY")
[ "$code" = 200 ] || fail "no-domain install: the claim page on the app port answered $code"

echo "INSTALL-E2E PASS"
