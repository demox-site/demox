#!/usr/bin/env bash
# Non-production check for the www signed-header fix.
# Connects to a test EdgeOne function default domain (*.eo-edgefunctions.com),
# not to rule-fxfyqmn5 and not to ef-1281msyw. Does not call ModifyFunction.
# Does not contain secrets. The cookie value below is a fixed placeholder.
#
# The router classifies the site from the request URL host. This script sends
# the real Host header (www, the user site, sites). If the default domain keeps
# its own URL and ignores Host, run the same URLs from that function's Web
# debugger (边缘函数 → 该测试函数 → 编辑代码 → HTTP 调试) and do not click
# save-and-deploy on ef-1281msyw.
#
#   EDGE_ORIGIN=subdomain-router-test.eo-edgefunctions.com \
#   USER_HOST=coverage.demox.site \
#   BANNED_URL='https://sites.demox.site/sites/<uid>/<ID>/dist/index.html' \
#   bash scripts/origin-guard-www-verify.sh
#
# REQUIRE_INTERNAL=1 (default) expects x-demox-route: origin-guard=internal on
# www /, /pricing and the 404 path. That header is written only when this same
# build handles the sites re-entry. Leave it on when the debugger request URL
# is https://www.demox.site/... and this build re-enters itself. Set
# REQUIRE_INTERNAL=0 only when a different function answers the subrequest;
# 423 still fails the run.
set -u

EDGE_ORIGIN=${EDGE_ORIGIN:-}
USER_HOST=${USER_HOST:-coverage.demox.site}
BANNED_URL=${BANNED_URL:-}
REQUIRE_INTERNAL=${REQUIRE_INTERNAL:-1}
MAX_TIME=${MAX_TIME:-20}

if [ -z "$EDGE_ORIGIN" ]; then
  echo "EDGE_ORIGIN is required (test function default domain, not www.demox.site)" >&2
  exit 2
fi
case "$EDGE_ORIGIN" in
  *www.demox.site*|*sites.demox.site*)
    echo "refusing to connect to a production host: $EDGE_ORIGIN" >&2
    exit 2
    ;;
esac

fail=0

check() {
  local name="$1" url_host="$2" path="$3" expect="$4" want_internal="$5"
  local url="https://${EDGE_ORIGIN}${path}"
  local body headers err
  body="$(mktemp)"
  headers="$(mktemp)"
  err="$(mktemp)"
  local time_s
  time_s="$(curl -sS -D "$headers" -o "$body" --max-time "$MAX_TIME" --http1.1 \
    -w '%{time_total}' \
    -H "Host: ${url_host}" \
    -H "Accept: text/html" \
    -H "Accept-Language: zh-CN" \
    -H "User-Agent: DemoxVerify/1.0" \
    -H "EO-Connecting-IP: 203.0.113.8" \
    -H "EO-Client-IPCountry: SG" \
    -H "CDN-Loop: TencentEdgeOne; loops=1" \
    -H "Cookie: demox_access=verify-not-a-secret" \
    -H "X-Forwarded-Host: ${url_host}" \
    "$url" 2>"$err")" || {
      echo "FAIL $name curl error" >&2
      cat "$err" >&2
      fail=1
      rm -f "$body" "$headers" "$err"
      return
    }
  local status route
  status="$(awk 'BEGIN{c=""} /^HTTP/{c=$2} END{print c}' "$headers")"
  route="$(awk 'tolower($1)=="x-demox-route:"{print $2}' "$headers" | tr -d '\r')"
  printf '%s status=%s route=%s time=%ss host=%s path=%s\n' \
    "$name" "$status" "${route:-"(none)"}" "$time_s" "$url_host" "$path"
  if [ "$status" = "423" ]; then
    echo "FAIL $name HTTP 423 (EdgeOne loop). Stop." >&2
    fail=1
  elif [ "$status" != "$expect" ]; then
    echo "FAIL $name status $status wanted $expect" >&2
    fail=1
  fi
  if [ "$want_internal" = "1" ] && [ "$route" = "origin-guard=allow" ]; then
    echo "FAIL $name origin-guard=allow means the sites re-entry had no valid token" >&2
    fail=1
  elif [ "$want_internal" = "1" ] && [ "$REQUIRE_INTERNAL" = "1" ] && [ "$route" != "origin-guard=internal" ]; then
    echo "FAIL $name route '${route:-none}' wanted origin-guard=internal" >&2
    fail=1
  fi
  rm -f "$body" "$headers" "$err"
}

check "www /" "www.demox.site" "/" "200" "1"
check "www /pricing" "www.demox.site" "/pricing" "200" "1"
check "www 404 path" "www.demox.site" "/not-a-published-page" "404" "1"
check "public user site" "$USER_HOST" "/" "200" "0"

if [ -n "$BANNED_URL" ]; then
  banned_host="${BANNED_URL#https://}"
  banned_host="${banned_host%%/*}"
  banned_path="${BANNED_URL#https://$banned_host}"
  check "banned object" "$banned_host" "$banned_path" "403" "0"
else
  echo "SKIP banned object (set BANNED_URL=https://sites.demox.site/sites/<uid>/<ID>/dist/index.html)"
fi

if [ "$fail" != "0" ]; then
  exit 1
fi
echo "PASS"
