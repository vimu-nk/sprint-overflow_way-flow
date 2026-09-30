#!/bin/sh
# Provisions RustFS for WayFlow. Idempotent: safe to run on every `docker compose up`.
# Admin (root) credentials log in to the console; the API gets its own key scoped to one bucket.
set -eu

: "${RUSTFS_ADMIN_USER:?}" "${RUSTFS_ADMIN_PASSWORD:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}"
BUCKET="${S3_BUCKET:-pod}"
ENDPOINT="${S3_ENDPOINT:-http://rustfs:9000}"

rc alias set admin "$ENDPOINT" "$RUSTFS_ADMIN_USER" "$RUSTFS_ADMIN_PASSWORD" -q

rc bucket create --ignore-existing "admin/$BUCKET" -q

# Policy file is written for bucket "pod"; rewrite if a different bucket is configured.
sed "s/:::pod/:::$BUCKET/g" /init/app-policy.json > /tmp/app-policy.json
rc admin policy create admin wayflow-app /tmp/app-policy.json -q

# `user add` also resets the secret for an existing user, keeping it in sync with .env.
rc admin user add admin "$S3_ACCESS_KEY" "$S3_SECRET_KEY" -q
rc admin policy attach admin wayflow-app --user "$S3_ACCESS_KEY" -q || true

echo "RustFS ready: bucket '$BUCKET', app user '$S3_ACCESS_KEY' (policy wayflow-app)"
