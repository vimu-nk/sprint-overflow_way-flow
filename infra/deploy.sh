#!/bin/sh
# Idempotent deploy for the EC2 host. Run from anywhere on the VM, by hand or from CD:
#   ~/way-flow/infra/deploy.sh [git-ref]   (default: origin/main)
# Needs no local edits on the VM: .env and data/ are gitignored, everything else comes from the repo.
set -eu
cd "$(dirname "$0")/.."
REF="${1:-origin/main}"

git fetch --tags --prune origin
git reset --hard "$REF"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null

# Gateway answers on loopback only; fail the deploy if the API is not ready.
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8080/api/v1/ready >/dev/null && { echo "deployed $(git rev-parse --short HEAD)"; exit 0; }
  sleep 5
done
echo "API not ready after deploy" >&2
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps >&2
exit 1
