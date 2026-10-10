#!/usr/bin/env bash
# List custom domains that reach the gateway through an A record (no CNAME).
# Run on aigc BEFORE changing the gateway IP: these users must update their DNS themselves.
# Output: hostname<TAB>status<TAB>A records
set -euo pipefail
ROOT=/opt/demox-customer-proxy
# shellcheck disable=SC1091
source "$ROOT/.env"
GATEWAY_IPS="${GATEWAY_IPS:-119.91.123.2}"

mysql -N -h "$MYSQL_HOST" -P "${MYSQL_PORT:-3306}" -u "$MYSQL_USER" "-p${MYSQL_PASSWORD}" \
  -D "$MYSQL_DATABASE" --batch --raw -e "
SELECT cd.hostname, cd.status FROM custom_domains cd
WHERE cd.hostname NOT LIKE '%.demox.site' AND cd.hostname NOT LIKE '%aigc.sx.cn'
ORDER BY cd.hostname" |
while IFS=$'\t' read -r host status; do
  [[ -z "$host" ]] && continue
  cname="$(dig +short CNAME "$host" | head -1)"
  [[ -n "$cname" ]] && continue
  addrs="$(dig +short A "$host" | grep -E '^[0-9.]+$' | sort -u | tr '\n' ' ')"
  for ip in $addrs; do
    if [[ " ${GATEWAY_IPS} " == *" ${ip} "* ]]; then
      printf '%s\t%s\t%s\n' "$host" "$status" "$addrs"
      break
    fi
  done
done
