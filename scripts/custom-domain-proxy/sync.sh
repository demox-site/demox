#!/usr/bin/env bash
# Provision nginx vhosts for Demox custom domains that already pass CNAME checks.
# Runs on aigc. customers.demox.site must resolve here so HTTP-01 and HTTPS work.
set -euo pipefail

ROOT=/opt/demox-customer-proxy
# shellcheck disable=SC1091
source "$ROOT/.env"
NGINX_DIR="${NGINX_DIR:-/etc/nginx/conf.d}"
WEBROOT="${WEBROOT:-/var/www/demox-acme}"
ORIGIN_SUFFIX="${ORIGIN_SUFFIX:-demox.site}"
EMAIL="${ACME_EMAIL:-admin@demox.site}"
PREFIX=demox-custom
CHANGED=0
FILTER_HOST=""
if [[ "${1:-}" == "--host" ]]; then
  FILTER_HOST="$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z')"
  if [[ ! "$FILTER_HOST" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
    echo "invalid host" >&2
    exit 1
  fi
fi

mkdir -p "$WEBROOT" "$NGINX_DIR" /var/run
exec 9>/var/run/demox-customer-proxy.lock
flock -w 120 9 || exit 0

mysql_query() {
  mysql -N -h "$MYSQL_HOST" -P "${MYSQL_PORT:-3306}" -u "$MYSQL_USER" "-p${MYSQL_PASSWORD}" \
    -D "$MYSQL_DATABASE" --batch --raw -e "$1"
}

write_http_only() {
  local host="$1"
  cat >"$NGINX_DIR/${PREFIX}-${host}.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
}

write_https() {
  local host="$1" origin="$2"
  cat >"$NGINX_DIR/${PREFIX}-${host}.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${host};
    ssl_certificate /etc/letsencrypt/live/${host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${host}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 32m;
    location / {
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name ${origin};
        proxy_set_header Host ${origin};
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_pass https://${origin};
    }
}
EOF
}

reload_nginx() {
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
  else
    echo "nginx -t failed; leaving previous config" >&2
    return 1
  fi
}

ensure_gateway() {
  local conf="$NGINX_DIR/${PREFIX}-gateway.conf"
  if grep -q '_demox/provision' "$conf" 2>/dev/null; then
    return 0
  fi
  cat >"$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name customers.demox.site;
    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }
    location = /_demox/provision {
        proxy_pass http://127.0.0.1:7391;
        proxy_read_timeout 90s;
        proxy_set_header Host \$host;
        proxy_set_header Authorization \$http_authorization;
        proxy_set_header Content-Type \$content_type;
    }
    location / {
        default_type text/plain;
        return 200 "Demox custom domain gateway\\n";
    }
}
EOF
  CHANGED=1
}

ensure_gateway

SQL_EXTRA=""
if [[ -n "$FILTER_HOST" ]]; then
  SQL_EXTRA="AND cd.hostname = '${FILTER_HOST}'"
fi

points_at_gateway() {
  local host="$1" hop current
  current="$host"
  for _ in 1 2 3 4 5 6; do
    hop="$(dig +short CNAME "$current" | awk 'NR==1{gsub(/\.$/,""); print tolower($0)}')"
    [[ -z "$hop" ]] && break
    [[ "$hop" == "customers.demox.site" ]] && return 0
    current="$hop"
  done
  return 1
}

wanted=()
while IFS=$'\t' read -r host website_id; do
  [[ -z "$host" || -z "$website_id" ]] && continue
  origin="$(printf '%s' "$website_id" | tr 'A-Z' 'a-z').${ORIGIN_SUFFIX}"
  wanted+=("$host")
  conf="$NGINX_DIR/${PREFIX}-${host}.conf"
  live="/etc/letsencrypt/live/${host}/fullchain.pem"

  if [[ ! -f "$conf" ]]; then
    write_http_only "$host"
    CHANGED=1
    reload_nginx || true
  fi

  if [[ ! -f "$live" ]]; then
    if points_at_gateway "$host"; then
      certbot certonly --webroot -w "$WEBROOT" -d "$host" \
        --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring \
        || echo "cert pending for $host"
    else
      echo "skip cert for $host: CNAME is not customers.demox.site"
    fi
  fi

  if [[ -f "$live" ]]; then
    write_https "$host" "$origin"
    CHANGED=1
  fi
done < <(mysql_query "
SELECT cd.hostname, w.website_id
FROM custom_domains cd
JOIN custom_domain_routes r ON r.custom_domain_id = cd.id AND r.label = ''
JOIN websites w ON w.id = r.website_id
WHERE cd.hostname NOT LIKE '%.demox.site'
  AND cd.hostname NOT LIKE '%aigc.sx.cn'
  ${SQL_EXTRA}
")

if [[ -n "$FILTER_HOST" ]]; then
  if [[ "$CHANGED" -eq 1 ]]; then
    reload_nginx
  fi
  exit 0
fi

shopt -s nullglob
for conf in "$NGINX_DIR/${PREFIX}-"*.conf; do
  base="$(basename "$conf" .conf)"
  [[ "$base" == "${PREFIX}-gateway" ]] && continue
  host="${base#${PREFIX}-}"
  keep=0
  for item in "${wanted[@]+"${wanted[@]}"}"; do
    [[ "$item" == "$host" ]] && keep=1
  done
  if [[ "$keep" -eq 0 ]]; then
    rm -f "$conf"
    CHANGED=1
  fi
done

if [[ "$CHANGED" -eq 1 ]]; then
  reload_nginx
fi
