#!/usr/bin/env bash
# owner-mcp-setup.sh —— mint a throwaway owner keypair against a running, claimed
# dev backend, then drive the owner MCP server (owner_mcp.py) as an agent over the
# real Sigv1 stdio bridge. Revokes the keypair on exit.
#
# Assumes the dev stack is up + claimed with the e2e default owner (alice). For a
# different instance, override OWNER_EMAIL / OWNER_PASSWORD / BACKEND_URL.
set -euo pipefail
cd "$(dirname "$0")"

BACKEND="${BACKEND_URL:-http://localhost:8000}"
EMAIL="${OWNER_EMAIL:-alice@example.com}"
PASSWORD="${OWNER_PASSWORD:-correct-horse-battery-staple}"

cookie="$(mktemp)"
creds="$(mktemp)"
login="$(mktemp)"
kp="$(mktemp)"
cleanup() {
  if [ -n "${KEY_ID:-}" ]; then
    curl -s -b "$cookie" -X DELETE -H "X-Csrftoken: ${CSRF:-}" \
      "$BACKEND/api/admin/keypairs/$KEY_ID" >/dev/null 2>&1 || true
  fi
  rm -f "$cookie" "$creds" "$login" "$kp"
}
trap cleanup EXIT

echo ">>> login $EMAIL @ $BACKEND"
# Check the status: curl exits 0 on a 401, so without this the run limps on and dies three lines
# later inside python with `KeyError: 'key_id'` — which reads like a broken harness rather than
# "this instance has no such owner".
code="$(curl -s -c "$cookie" "$BACKEND/api/admin/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" -o "$login" -w '%{http_code}')"
echo "login HTTP $code"
if [ "$code" != "200" ]; then
  echo "login failed for $EMAIL at $BACKEND." >&2
  echo "The dev stack must be up AND claimed by this owner. Seed it with" >&2
  echo "  eval-harness/reseed-marcus.sh        # claims marcus@local.test + corpus" >&2
  echo "or point the eval at another instance:  OWNER_EMAIL=... OWNER_PASSWORD=... make eval-owner-mcp" >&2
  exit 1
fi
CSRF="$(python3 -c "import json;print(json.load(open('$login')).get('csrf_token',''))")"

echo ">>> mint keypair"
code="$(curl -s -b "$cookie" "$BACKEND/api/admin/keypairs" -H 'Content-Type: application/json' \
  -H "X-Csrftoken: $CSRF" -d '{"label":"owner-mcp-eval"}' -o "$kp" -w '%{http_code}')"
echo "keypair HTTP $code"
if [ "$code" != "200" ] && [ "$code" != "201" ]; then
  echo "could not mint an owner keypair (HTTP $code): $(head -c 200 "$kp")" >&2
  exit 1
fi
KEY_ID="$(python3 -c "import json;print(json.load(open('$kp'))['key_id'])")"
python3 -c "import json;d=json.load(open('$kp'));open('$creds','w').write(json.dumps({'keyId':d['key_id'],'privateKeyPem':d['private_key_pem']}))"

echo ">>> drive owner MCP as agent"
STANDMEET_HOST="$BACKEND" STANDMEET_CREDS_PATH="$creds" python3 owner_mcp.py
