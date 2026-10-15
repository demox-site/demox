#!/usr/bin/env bash
# Public GETs against the k2t-* non-production hosts only.
# The inner hop runs this same build on k2t-sites, so REQUIRE_INTERNAL=1
# is mandatory and cannot be turned off.
# Does not store a response body, an IP, or a Cookie. Does not call ModifyFunction.
# Does not contain secrets. Production has no x-demox-env: nonprod, so this
# script fails closed until ef-k2test is in front of these hosts.
#
#   BANNED_PATH='/sites/<uid>/<ID>/dist/index.html' \
#   PRIVATE_PATH='/sites/<uid>/33I17FK6/dist/index.html' \
#   bash scripts/origin-guard-www-verify.sh
#
# BASE defaults to k2t. Paths are path-only. The public www object path is fixed.
set -u

if [ "${REQUIRE_INTERNAL:-1}" != "1" ]; then
  echo "REQUIRE_INTERNAL=1 is mandatory on the k2t-* hosts; the inner hop runs this build" >&2
  exit 2
fi
REQUIRE_INTERNAL=1

BASE=${BASE:-k2t}
BANNED_PATH=${BANNED_PATH:-}
PRIVATE_PATH=${PRIVATE_PATH:-}
MAX_TIME=${MAX_TIME:-20}
BURST=${BURST:-20}
PUBLIC_PATH=/sites/1985655011013808129/EPX2UU43/dist/index.html

WWW="${BASE}-www.demox.site"
SITES="${BASE}-sites.demox.site"
PUB="${BASE}-pub.demox.site"
BAN="${BASE}-ban.demox.site"

for host in "$WWW" "$SITES" "$PUB" "$BAN"; do
  case "$host" in
    www.demox.site|sites.demox.site|coverage.demox.site|demox.site)
      echo "refusing to connect to a production host: $host" >&2
      exit 2
      ;;
  esac
done

if [ -z "$BANNED_PATH" ] || [ -z "$PRIVATE_PATH" ]; then
  echo "BANNED_PATH and PRIVATE_PATH are required (path only, no host)" >&2
  exit 2
fi
for path in "$BANNED_PATH" "$PRIVATE_PATH" "$PUBLIC_PATH"; do
  case "$path" in
    /*) ;;
    *) echo "path must start with /: $path" >&2; exit 2 ;;
  esac
  case "$path" in
    *"://"*|*"demox.site"*) echo "path must not contain a host: $path" >&2; exit 2 ;;
  esac
done

fail=0
home_times="$(mktemp)"

finish() {
  rm -f "$home_times"
}
trap finish EXIT

note_bad_status() {
  local name="$1" status="$2"
  if [ "$status" = "423" ]; then
    echo "FAIL $name HTTP 423" >&2
    fail=1
    return
  fi
  if [ "$status" -ge 500 ] 2>/dev/null; then
    echo "FAIL $name HTTP $status" >&2
    fail=1
  fi
}

check() {
  local name="$1" host="$2" path="$3" expect="$4" route_mode="$5"
  local headers err status route env_hdr
  headers="$(mktemp)"
  err="$(mktemp)"
  local time_s
  time_s="$(curl -sS -D "$headers" -o /dev/null --max-time "$MAX_TIME" --http1.1 \
    -w '%{time_total}' \
    -H "Host: ${host}" \
    -H "Accept: text/html" \
    -H "User-Agent: DemoxVerify/1.0" \
    "https://${host}${path}" 2>"$err")" || {
      echo "FAIL $name curl error" >&2
      cat "$err" >&2
      fail=1
      rm -f "$headers" "$err"
      return
    }
  status="$(awk 'BEGIN{c=""} /^HTTP/{c=$2} END{print c}' "$headers" | tr -d '\r')"
  route="$(awk 'tolower($1)=="x-demox-route:"{print $2}' "$headers" | tr -d '\r')"
  env_hdr="$(awk 'tolower($1)=="x-demox-env:"{print $2}' "$headers" | tr -d '\r')"
  printf '%s status=%s route=%s env=%s time=%ss host=%s path=%s\n' \
    "$name" "$status" "${route:-"(none)"}" "${env_hdr:-"(none)"}" "$time_s" "$host" "$path"
  if [ "$name" = "www /" ]; then
    printf '%s\n' "$time_s" >>"$home_times"
  fi
  note_bad_status "$name" "$status"
  if [ "$status" != "$expect" ]; then
    echo "FAIL $name status $status wanted $expect" >&2
    fail=1
  fi
  if [ "$env_hdr" != "nonprod" ]; then
    echo "FAIL $name x-demox-env '${env_hdr:-none}' wanted nonprod" >&2
    fail=1
  fi
  if [ "$route" = "origin-guard=error" ]; then
    echo "FAIL $name origin-guard=error" >&2
    fail=1
  fi
  if [ "$route_mode" = "internal" ]; then
    if [ "$REQUIRE_INTERNAL" != "1" ] || [ "$route" != "origin-guard=internal" ]; then
      echo "FAIL $name route '${route:-none}' wanted origin-guard=internal" >&2
      fail=1
    fi
  elif [ "$route_mode" = "allow" ]; then
    if [ "$route" != "origin-guard=allow" ]; then
      echo "FAIL $name route '${route:-none}' wanted origin-guard=allow" >&2
      fail=1
    fi
  elif [ "$route_mode" = "blocked" ]; then
    if [ "$route" != "origin-guard=blocked" ]; then
      echo "FAIL $name route '${route:-none}' wanted origin-guard=blocked" >&2
      fail=1
    fi
    if ! awk 'BEGIN{ok=0} tolower($1)=="cache-control:" && tolower($0) ~ /no-store/ {ok=1} END{exit !ok}' "$headers"; then
      echo "FAIL $name blocked response is missing Cache-Control: no-store" >&2
      fail=1
    fi
    if awk 'tolower($1) ~ /^(eo-cache-status|x-cache|x-cache-lookup):/ && tolower($0) ~ /hit/' "$headers" | grep -q .; then
      echo "FAIL $name cache HIT on a blocked object" >&2
      fail=1
    fi
  fi
  rm -f "$headers" "$err"
}

nope_path="/k2t-nope-${RANDOM}"
for _ in $(seq 1 "$BURST"); do
  check "www /" "$WWW" "/" "200" "internal"
  check "www /pricing" "$WWW" "/pricing" "200" "internal"
  check "www 404 path" "$WWW" "$nope_path" "404" "internal"
  if [ "$fail" != "0" ]; then
    break
  fi
done

if [ "$fail" = "0" ]; then
  read -r median p90 < <(sort -n "$home_times" | awk '
    { a[NR] = $1 + 0 }
    END {
      if (NR == 0) exit 1
      if (NR % 2 == 1) med = a[(NR + 1) / 2]
      else med = (a[NR / 2] + a[NR / 2 + 1]) / 2
      idx = int((9 * NR + 9) / 10)
      if (idx < 1) idx = 1
      if (idx > NR) idx = NR
      printf "%.3f %.3f\n", med, a[idx]
    }')
  printf 'www / samples=%s median=%ss p90=%ss\n' "$(wc -l <"$home_times" | tr -d ' ')" "$median" "$p90"
  awk -v med="$median" -v p90="$p90" 'BEGIN {
    if (med + 0 > 2.40) { print "FAIL www / median " med "s wanted <= 2.40s" > "/dev/stderr"; exit 1 }
    if (p90 + 0 > 4.813) { print "FAIL www / p90 " p90 "s wanted <= 4.813s" > "/dev/stderr"; exit 1 }
  }' || fail=1
fi

check "public object" "$SITES" "$PUBLIC_PATH" "200" "allow"
check "banned object" "$SITES" "$BANNED_PATH" "403" "blocked"
check "banned object again" "$SITES" "$BANNED_PATH" "403" "blocked"
check "banned host" "$BAN" "/" "403" "status"
check "private object" "$SITES" "$PRIVATE_PATH" "403" "blocked"
check "public user site" "$PUB" "/" "200" "status"

if [ "$fail" != "0" ]; then
  exit 1
fi
echo "PASS"
