#!/bin/bash
set -e

echo "Running migrations..."
uv run python manage.py migrate --noinput

echo "Ensuring S3 bucket exists..."
uv run python manage.py shell -c "from infrastructure.storage.s3_client import MinioAssetStorage; MinioAssetStorage().ensure_bucket()"

# Generate owner JWT on first deploy (set STANDMEET_GENERATE_TOKEN=true)
if [ "$STANDMEET_GENERATE_TOKEN" = "true" ]; then
  echo ""
  echo "================================================"
  echo "  Generating owner JWT token..."
  echo "================================================"
  uv run python manage.py create_owner_token --jwt --label "admin" --expires-in-days 90
  echo "================================================"
  echo "  Save this token! Then set"
  echo "  STANDMEET_GENERATE_TOKEN=false to stop regenerating."
  echo "================================================"
  echo ""
fi

exec uv run "$@"
