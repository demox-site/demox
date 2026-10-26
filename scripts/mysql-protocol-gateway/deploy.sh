#!/usr/bin/env bash
# Deploy MySQL protocol gateway to aigc (custom-domain host).
# Usage (from laptop/agent with SSH key):
#   ENCRYPTION_KEY=... ./deploy.sh root@119.91.123.2
set -euo pipefail
HOST="${1:?usage: deploy.sh user@host}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
REMOTE="/opt/demox-mysql-gateway"

ssh -o IdentitiesOnly=yes "$HOST" "mkdir -p '$REMOTE'"
scp -o IdentitiesOnly=yes \
  "$ROOT/server.py" "$ROOT/store.py" "$ROOT/crypto_util.py" \
  "$ROOT/requirements.txt" "$ROOT/demox-mysql-gateway.service" \
  "$HOST:$REMOTE/"

ssh -o IdentitiesOnly=yes "$HOST" bash -s <<REMOTE
set -euo pipefail
cd /opt/demox-mysql-gateway
python3 -m venv venv
./venv/bin/pip install -q -U pip
./venv/bin/pip install -q -r requirements.txt
# Merge MYSQL_* from customer-proxy + ENCRYPTION_KEY from env file if present
if [ ! -f .env ]; then
  umask 077
  {
    grep -E '^(MYSQL_HOST|MYSQL_PORT|MYSQL_USER|MYSQL_PASSWORD|MYSQL_DATABASE)=' /opt/demox-customer-proxy/.env
    echo "DEMOX_MYSQL_GATEWAY_HOST=0.0.0.0"
    echo "DEMOX_MYSQL_GATEWAY_PORT=3306"
    if [ -n "${ENCRYPTION_KEY:-}" ]; then
      printf 'ENCRYPTION_KEY=%s\n' "$ENCRYPTION_KEY"
    fi
  } > .env
  chmod 600 .env
  if ! grep -q '^ENCRYPTION_KEY=' .env; then
    echo "NOTE: append ENCRYPTION_KEY=... to /opt/demox-mysql-gateway/.env before start" >&2
  fi
fi
install -m 644 demox-mysql-gateway.service /etc/systemd/system/demox-mysql-gateway.service
systemctl daemon-reload
systemctl enable demox-mysql-gateway.service
systemctl restart demox-mysql-gateway.service
systemctl --no-pager --full status demox-mysql-gateway.service | head -20
REMOTE
