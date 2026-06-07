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
curl -s -c "$cookie" "$BACKEND/api/admin/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" -o "$login" -w 'login HTTP %{http_code}\n'
CSRF="$(python3 -c "import json;print(json.load(open('$login')).get('csrf_token',''))")"

echo ">>> mint keypair"
curl -s -b "$cookie" "$BACKEND/api/admin/keypairs" -H 'Content-Type: application/json' \
  -H "X-Csrftoken: $CSRF" -d '{"label":"owner-mcp-eval"}' -o "$kp" -w 'keypair HTTP %{http_code}\n'
KEY_ID="$(python3 -c "import json;print(json.load(open('$kp'))['key_id'])")"
python3 -c "import json;d=json.load(open('$kp'));open('$creds','w').write(json.dumps({'keyId':d['key_id'],'privateKeyPem':d['private_key_pem']}))"

echo ">>> drive owner MCP as agent"
STANDMEET_HOST="$BACKEND" STANDMEET_CREDS_PATH="$creds" python3 owner_mcp.py
