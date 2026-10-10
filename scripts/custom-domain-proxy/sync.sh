#!/usr/bin/env bash
# Provision nginx vhosts for Demox custom domains that already pass CNAME checks.
# Runs on aigc. customers.demox.site must resolve here so HTTP-01 and HTTPS work.
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ROOT=/opt/demox-customer-proxy
# shellcheck disable=SC1091
source "$ROOT/.env"
NGINX_DIR="${NGINX_DIR:-/etc/nginx/conf.d}"
WEBROOT="${WEBROOT:-/var/www/demox-acme}"
ORIGIN_SUFFIX="${ORIGIN_SUFFIX:-demox.site}"
EMAIL="${ACME_EMAIL:-admin@demox.site}"
GATEWAY_IPS="${GATEWAY_IPS:-119.91.123.2}"
PREFIX=demox-custom
# Per-domain backoff for failed first-time issuance, so a domain that keeps failing
# HTTP-01 (e.g. ICP-blocked on port 80) can't get the Let's Encrypt account paused.
# Renewals are done by certbot's own timer (certbot-renew.timer) and are never backed off here.
ACME_FAIL_DIR="${ACME_FAIL_DIR:-/var/lib/demox-customer-proxy/acme-fail}"
# A user-triggered `--host` run may retry this soon after the last failure, even inside the backoff.
ACME_MANUAL_MIN_SECS="${ACME_MANUAL_MIN_SECS:-900}"
CERT_WARN_DAYS="${CERT_WARN_DAYS:-25}"
CHANGED=0
FILTER_HOST=""
if [[ "${1:-}" == "--host" ]]; then
  FILTER_HOST="$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z')"
  if [[ ! "$FILTER_HOST" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
    echo "invalid host" >&2
    exit 1
  fi
fi

mkdir -p "$WEBROOT" "$NGINX_DIR" /var/run "$ACME_FAIL_DIR"
exec 9>/var/run/demox-customer-proxy.lock
flock -w 120 9 || exit 0

mysql_query() {
  mysql -N -h "$MYSQL_HOST" -P "${MYSQL_PORT:-3306}" -u "$MYSQL_USER" "-p${MYSQL_PASSWORD}" \
    -D "$MYSQL_DATABASE" --batch --raw -e "$1"
}

write_if_changed() {
  local dest="$1" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if [[ -f "$dest" ]] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$dest"
  return 0
}

write_http_only() {
  local host="$1"
  write_if_changed "$NGINX_DIR/${PREFIX}-${host}.conf" <<EOF
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
  # aigc has no public IPv6. podfwngc.demox.site has many AAAA records;
  # proxy_pass to the hostname makes nginx try those first and the request fails.
  write_if_changed "$NGINX_DIR/${PREFIX}-${host}.conf" <<EOF
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
        resolver 119.29.29.29 223.5.5.5 ipv6=off valid=30s;
        resolver_timeout 2s;
        set \$demox_origin ${origin};
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name ${origin};
        proxy_set_header Host ${origin};
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_connect_timeout 5s;
        proxy_pass https://\$demox_origin;
    }
}
EOF
}

reload_nginx() {
  if /usr/sbin/nginx -t; then
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

# --- acme backoff: begin (sourced by sync-backoff.test.sh) ---
# Backoff after N consecutive failures: 1h, 6h, 24h, 48h, 96h, then 7 days.
acme_backoff_secs() {
  case "$1" in
    1) echo 3600 ;;
    2) echo 21600 ;;
    3) echo 86400 ;;
    4) echo 172800 ;;
    5) echo 345600 ;;
    *) echo 604800 ;;
  esac
}

# Prints "count last_epoch" (0 0 when the domain has no recorded failures).
acme_fail_state() {
  local f="$ACME_FAIL_DIR/$1" count=0 last=0
  if [[ -f "$f" ]]; then
    read -r count last <"$f" || true
    [[ "$count" =~ ^[0-9]+$ ]] || count=0
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
  fi
  echo "$count $last"
}

# Returns 0 (and logs a skip line) when a new issuance attempt for $1 must wait.
acme_in_backoff() {
  local host="$1" count last now wait due
  read -r count last < <(acme_fail_state "$host")
  [[ "$count" -eq 0 ]] && return 1
  now="$(date +%s)"
  wait="$(acme_backoff_secs "$count")"
  if [[ -n "$FILTER_HOST" && "$wait" -gt "$ACME_MANUAL_MIN_SECS" ]]; then
    wait="$ACME_MANUAL_MIN_SECS"
  fi
  due=$((last + wait))
  if [[ "$now" -lt "$due" ]]; then
    echo "skip cert for $host: backoff after $count failed attempt(s), next try after $(date -d "@$due" '+%F %T %Z')"
    return 0
  fi
  return 1
}

acme_record_failure() {
  local host="$1" count last
  read -r count last < <(acme_fail_state "$host")
  count=$((count + 1))
  printf '%s %s\n' "$count" "$(date +%s)" >"$ACME_FAIL_DIR/$host"
  echo "cert pending for $host: attempt $count failed, backing off $(( $(acme_backoff_secs "$count") / 3600 ))h"
}

acme_clear_failures() {
  rm -f "$ACME_FAIL_DIR/$1"
}

# Renewal is certbot-renew.timer's job; shout if a live cert is getting close to expiry anyway.
warn_if_cert_expiring() {
  local host="$1" cert="/etc/letsencrypt/live/$1/cert.pem" end
  [[ -f "$cert" ]] || return 0
  if ! openssl x509 -in "$cert" -noout -checkend $((CERT_WARN_DAYS * 86400)) >/dev/null 2>&1; then
    end="$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | cut -d= -f2)"
    echo "WARNING: cert for $host expires $end (< ${CERT_WARN_DAYS} days) - renewal is failing, check certbot-renew.timer / port 80" >&2
  fi
}

# --- acme backoff: end ---

points_at_gateway() {
  local host="$1" hop current
  current="$host"
  for _ in 1 2 3 4 5 6; do
    hop="$(dig +short CNAME "$current" | awk 'NR==1{gsub(/\.$/,""); print tolower($0)}')"
    [[ -z "$hop" ]] && break
    [[ "$hop" == "customers.demox.site" ]] && return 0
    current="$hop"
  done
  # Apex domains / flattened CNAMEs: accept when every A record is the gateway itself.
  local addrs
  addrs="$(dig +short A "$host" | grep -E '^[0-9.]+$' | sort -u)"
  [[ -z "$addrs" ]] && return 1
  while read -r ip; do
    [[ " ${GATEWAY_IPS} " == *" ${ip} "* ]] || return 1
  done <<<"$addrs"
  return 0
}

wanted=()
while IFS=$'\t' read -r host website_id; do
  [[ -z "$host" || -z "$website_id" ]] && continue
  origin="$(printf '%s' "$website_id" | tr 'A-Z' 'a-z').${ORIGIN_SUFFIX}"
  wanted+=("$host")
  conf="$NGINX_DIR/${PREFIX}-${host}.conf"
  live="/etc/letsencrypt/live/${host}/fullchain.pem"

  if [[ ! -f "$conf" ]]; then
    if write_http_only "$host"; then
      CHANGED=1
      reload_nginx || true
    fi
  fi

  if [[ ! -f "$live" ]]; then
    if acme_in_backoff "$host"; then
      :
    elif points_at_gateway "$host"; then
      if certbot certonly --webroot -w "$WEBROOT" -d "$host" \
        --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring; then
        acme_clear_failures "$host"
      else
        acme_record_failure "$host"
      fi
    else
      echo "skip cert for $host: DNS does not reach customers.demox.site (CNAME or gateway A record)"
    fi
  fi

  if [[ -f "$live" ]]; then
    acme_clear_failures "$host"
    warn_if_cert_expiring "$host"
    if write_https "$host" "$origin"; then
      CHANGED=1
    fi
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
