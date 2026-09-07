#!/usr/bin/env bash
# reseed-marcus.sh —— 把 dev 实例重新做成「marcus claimed + DeepSeek + 语料 +
# RECRUIT-MARCUS code」,供 owner 手动试用。e2e 跑完会 truncate,这个补回来。
# 一次性脚本:reset → claim → DeepSeek provider → mint keypair → seed_persona。
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a   # EVAL_PROVIDER/ENDPOINT/MODEL/KEY

# Which stack this checkout drives.
#
# Read from the checkout's own .dev-stack.env, because this script is run BY HAND rather than
# through the Makefile, so nothing has exported those values for it. Hardcoded — as the project
# name and both ports were — a second checkout running this truncates the FIRST checkout's
# `owners` table and then claims an instance that is not the one it is about to talk to. The
# person on the other stack loses their state mid-session with nothing to connect it to.
# No file → the values that were hardcoded here before.
[ -f ../.dev-stack.env ] && { set -a; source ../.dev-stack.env; set +a; }
PROJECT=${COMPOSE_PROJECT_NAME:-standmeet-dev}
DB_CONTAINER=$PROJECT-db-1
REDIS_CONTAINER=$PROJECT-redis-1

BACKEND=http://localhost:${DEV_PORT_BACKEND:-8000}
PUBLIC=http://localhost:${DEV_PORT_APP:-38127}
EMAIL=marcus@local.test
PASS=correct-horse-battery-staple
HANDLE=marcus

echo ">>> 1. reset (truncate + unclaim + redis flush)"
# owners CASCADE, not a hand-written table list. The old list named wiki_entries / raw_entries /
# media_assets, which the corpus_notes consolidation removed — psql then aborted the WHOLE
# statement ("relation does not exist"), so the reset silently did nothing and the claim below
# failed on an instance that was still claimed. CASCADE follows the foreign keys instead, so a
# renamed or added owner-scoped table needs no edit here. instance_settings has no FK to owners
# and survives — the setup token below depends on that.
docker exec $DB_CONTAINER psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 -c \
  "TRUNCATE owners RESTART IDENTITY CASCADE" >/dev/null
docker exec $DB_CONTAINER psql -U standmeet -d standmeet -v ON_ERROR_STOP=1 -c \
  "TRUNCATE job_fingerprints RESTART IDENTITY" >/dev/null
docker exec $DB_CONTAINER psql -U standmeet -d standmeet -c \
  "UPDATE instance_settings SET is_claimed = false WHERE id = 1" >/dev/null
docker exec $REDIS_CONTAINER redis-cli FLUSHALL >/dev/null

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
