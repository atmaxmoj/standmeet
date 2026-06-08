#!/usr/bin/env bash
# reseed-marcus.sh —— 把 dev 实例重新做成「marcus claimed + DeepSeek + 语料 +
# RECRUIT-MARCUS code」,供 owner 手动试用。e2e 跑完会 truncate,这个补回来。
# 一次性脚本:reset → claim → DeepSeek provider → mint keypair → seed_persona。
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a   # EVAL_PROVIDER/ENDPOINT/MODEL/KEY

BACKEND=http://localhost:8000
PUBLIC=http://localhost:38127
EMAIL=marcus@local.test
PASS=correct-horse-battery-staple
HANDLE=marcus

echo ">>> 1. reset (truncate + unclaim + redis flush)"
docker exec standmeet-dev-db-1 psql -U standmeet -d standmeet -c \
  "TRUNCATE messages, conversations, code_members, applications, access_codes, wiki_entries, raw_entries, media_assets, page_content, resume_drafts, job_fingerprints, job_sources, owner_keypairs, owners RESTART IDENTITY CASCADE" >/dev/null
docker exec standmeet-dev-db-1 psql -U standmeet -d standmeet -c \
  "UPDATE instance_settings SET is_claimed = false WHERE id = 1" >/dev/null
docker exec standmeet-dev-redis-1 redis-cli FLUSHALL >/dev/null

echo ">>> 2. setup token"
TOKEN=$(curl -sS $BACKEND/api/v1/instance | jq -r .setup_token)
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || { echo "no setup token"; exit 1; }

echo ">>> 3. claim $EMAIL (handle=$HANDLE)"
curl -sS -X POST $BACKEND/api/admin/claim -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"handle\":\"$HANDLE\",\"full_name\":\"Marcus Chen\",\"public_url\":\"$PUBLIC\"}" \
  -w 'claim HTTP %{http_code}\n' -o /dev/null

echo ">>> 4. login"
cookie=$(mktemp)
csrf=$(curl -sS -c "$cookie" -X POST $BACKEND/api/admin/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .csrf_token)

echo ">>> 5. set DeepSeek provider ($EVAL_MODEL)"
curl -sS -b "$cookie" -X PATCH $BACKEND/api/admin/ai-provider -H 'Content-Type: application/json' \
  -H "X-Csrftoken: $csrf" \
  -d "{\"provider\":\"$EVAL_PROVIDER\",\"endpoint\":\"$EVAL_ENDPOINT\",\"model\":\"$EVAL_MODEL\",\"key_change\":\"set\",\"key\":\"$EVAL_KEY\"}" \
  -w 'ai-provider HTTP %{http_code}\n' -o /dev/null

echo ">>> 6. mint MCP keypair"
creds=$(mktemp)
curl -sS -b "$cookie" -X POST $BACKEND/api/admin/keypairs -H 'Content-Type: application/json' \
  -H "X-Csrftoken: $csrf" -d '{"label":"marcus-seed"}' \
  | jq '{keyId:.key_id, privateKeyPem:.private_key_pem}' > "$creds"

echo ">>> 7. seed_persona (corpus + prompt + role + RECRUIT-MARCUS code)"
STANDMEET_HOST=$BACKEND STANDMEET_CREDS_PATH="$creds" \
  EVAL_PERSONA=fixtures/personas/marcus-chen PUBLIC_URL=$PUBLIC \
  python3 seed_persona.py

rm -f "$cookie" "$creds"
echo ">>> done. visitor link: $PUBLIC/?code=RECRUIT-MARCUS"
