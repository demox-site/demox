#!/usr/bin/env bash
# Public GETs against allowlisted non-production hosts only.
# Allowlist: *.eo-edgefunctions.com and k2t-*.demox.site. Anything else is refused.
# The inner hop on k2t-* runs this same build, so REQUIRE_INTERNAL=1 is mandatory.
# A run that would send a production Host never prints PASS, including REQUIRE_INTERNAL=0.
# Run logs can contain a site uid. They are written outside the repo.
# Response bodies are read only to check markers, then deleted. No IP or Cookie is stored.
# Does not call ModifyFunction. Does not contain secrets.
#
#   BANNED_PATH='/sites/<uid>/<ID>/dist/index.html' \
#   PRIVATE_PATH='/sites/<uid>/33I17FK6/dist/index.html' \
#   bash scripts/origin-guard-www-verify.sh
#
#   VERIFY_SELFTEST=1 bash scripts/origin-guard-www-verify.sh
set -u

host_allowed() {
  case "$1" in
    *.eo-edgefunctions.com|k2t-*.demox.site) return 0 ;;
    *) return 1 ;;
  esac
}

# 0 means this combination is allowed to finish with PASS.
may_print_pass() {
  local internal="$1"
  shift
  local host
  for host in "$@"; do
    if ! host_allowed "$host"; then
      return 1
    fi
  done
  if [ "$internal" != "1" ]; then
    return 1
  fi
  return 0
}

if [ "${VERIFY_SELFTEST:-}" = "1" ]; then
  fail=0
  expect_allow() {
    if ! host_allowed "$1"; then
      echo "FAIL allowlist rejected $1" >&2
      fail=1
    fi
  }
  expect_deny() {
    if host_allowed "$1"; then
      echo "FAIL allowlist accepted $1" >&2
      fail=1
    fi
  }
  expect_allow "k2t-www.demox.site"
  expect_allow "k2t-sites.demox.site"
  expect_allow "k2t-apex.demox.site"
  expect_allow "k2t-pub.demox.site"
  expect_allow "k2t-ban.demox.site"
  expect_allow "subdomain-router-test.eo-edgefunctions.com"
  expect_allow "a.b.eo-edgefunctions.com"
  expect_deny "www.demox.site"
  expect_deny "sites.demox.site"
  expect_deny "coverage.demox.site"
  expect_deny "demox.site"
  expect_deny "k2t.demox.site"
  expect_deny "notk2t-www.demox.site"
  expect_deny "k2t-www.demox.site.evil.example"
  expect_deny "evil.com"
  expect_deny ""
  if may_print_pass 0 "www.demox.site"; then
    echo "FAIL REQUIRE_INTERNAL=0 would PASS for a production host" >&2
    fail=1
  fi
  if may_print_pass 0 "k2t-www.demox.site" "sites.demox.site"; then
    echo "FAIL REQUIRE_INTERNAL=0 would PASS when a production host is included" >&2
    fail=1
  fi
  if may_print_pass 1 "www.demox.site" "coverage.demox.site"; then
    echo "FAIL production hosts would PASS" >&2
    fail=1
  fi
  if may_print_pass 0 "k2t-www.demox.site" "k2t-sites.demox.site"; then
    echo "FAIL REQUIRE_INTERNAL=0 would PASS for k2t hosts" >&2
    fail=1
  fi
  if ! may_print_pass 1 "k2t-www.demox.site" "k2t-sites.demox.site" "k2t-pub.demox.site" "k2t-ban.demox.site"; then
    echo "FAIL k2t hosts with REQUIRE_INTERNAL=1 were refused" >&2
    fail=1
  fi
  if ! may_print_pass 1 "subdomain-router-test.eo-edgefunctions.com"; then
    echo "FAIL eo-edgefunctions.com with REQUIRE_INTERNAL=1 was refused" >&2
    fail=1
  fi
  if [ "$fail" != "0" ]; then
    exit 1
  fi
  echo "PASS"
  exit 0
fi

BASE=${BASE:-k2t}
BANNED_PATH=${BANNED_PATH:-}
PRIVATE_PATH=${PRIVATE_PATH:-}
MAX_TIME=${MAX_TIME:-20}
BURST=${BURST:-20}
PUBLIC_PATH=/sites/1985655011013808129/EPX2UU43/dist/index.html
INTERNAL="${REQUIRE_INTERNAL:-1}"

WWW="${BASE}-www.demox.site"
SITES="${BASE}-sites.demox.site"
PUB="${BASE}-pub.demox.site"
BAN="${BASE}-ban.demox.site"

outside=0
for host in "$WWW" "$SITES" "$PUB" "$BAN"; do
  if ! host_allowed "$host"; then
    echo "refusing host outside allowlist (*.eo-edgefunctions.com or k2t-*.demox.site): $host" >&2
    outside=1
  fi
done
if [ "$outside" != "0" ]; then
  if [ "$INTERNAL" = "0" ]; then
    echo "REQUIRE_INTERNAL=0 cannot PASS when the script would send a non-allowlisted host" >&2
  fi
  exit 2
fi
if [ "$INTERNAL" != "1" ]; then
  echo "REQUIRE_INTERNAL=1 is mandatory on the k2t-* hosts; the inner hop runs this build" >&2
  exit 2
fi
REQUIRE_INTERNAL=1

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

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${DEMOX_VERIFY_LOG:-/tmp/demox-origin-guard-verify/origin-guard-www-verify.log}"
case "$LOG_FILE" in
  /*) ;;
  *)
    echo "DEMOX_VERIFY_LOG must be an absolute path outside the repo" >&2
    exit 2
    ;;
esac
case "$LOG_FILE" in
  "$REPO_ROOT"|"$REPO_ROOT"/*)
    echo "refusing to write verify logs inside the repo" >&2
    exit 2
    ;;
esac
mkdir -p "$(dirname "$LOG_FILE")"

fail=0
home_times="$(mktemp)"
log_line() {
  printf '%s\n' "$*" | tee -a "$LOG_FILE"
}

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

body_ok() {
  local name="$1" mode="$2" body="$3"
  local magic
  magic="$(od -An -tx1 -N2 "$body" 2>/dev/null | tr -d ' \n')"
  if [ "$magic" = "1f8b" ]; then
    echo "FAIL $name body is gzip-compressed and would render garbled" >&2
    fail=1
    return
  fi
  case "$mode" in
    page)
      if ! grep -q 'id="root"' "$body" || ! grep -q 'What is Demox?' "$body"; then
        echo "FAIL $name body is missing the www page markers" >&2
        fail=1
      fi
      ;;
    html404)
      if ! grep -qiE '<!doctype|<html' "$body"; then
        echo "FAIL $name 404 body is not HTML" >&2
        fail=1
      elif ! grep -qE 'Page Not Found|页面未找到|404' "$body"; then
        echo "FAIL $name 404 body has no 404 marker" >&2
        fail=1
      fi
      ;;
    denied)
      if ! grep -qE '无法访问|此站点已被停用' "$body"; then
        echo "FAIL $name 403 body is not the denial page" >&2
        fail=1
      fi
      if grep -q 'What is Demox?' "$body" || grep -q '<script' "$body"; then
        echo "FAIL $name 403 body contains banned or site content" >&2
        fail=1
      fi
      ;;
  esac
}

check() {
  local name="$1" host="$2" path="$3" expect="$4" route_mode="$5" body_mode="${6:-}"
  local headers err body status route env_hdr
  headers="$(mktemp)"
  err="$(mktemp)"
  body="$(mktemp)"
  local time_s
  time_s="$(curl -sS -D "$headers" -o "$body" --max-time "$MAX_TIME" --http1.1 \
    -w '%{time_total}' \
    -H "Host: ${host}" \
    -H "Accept: text/html" \
    -H "User-Agent: DemoxVerify/1.0" \
    "https://${host}${path}" 2>"$err")" || {
      echo "FAIL $name curl error" >&2
      cat "$err" >&2
      fail=1
      rm -f "$headers" "$err" "$body"
      return
    }
  status="$(awk 'BEGIN{c=""} /^HTTP/{c=$2} END{print c}' "$headers" | tr -d '\r')"
  route="$(awk 'tolower($1)=="x-demox-route:"{print $2}' "$headers" | tr -d '\r')"
  env_hdr="$(awk 'tolower($1)=="x-demox-env:"{print $2}' "$headers" | tr -d '\r')"
  log_line "$(printf '%s status=%s route=%s env=%s time=%ss host=%s path=%s' \
    "$name" "$status" "${route:-"(none)"}" "${env_hdr:-"(none)"}" "$time_s" "$host" "$path")"
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
  if [ -n "$body_mode" ]; then
    body_ok "$name" "$body_mode" "$body"
  fi
  rm -f "$headers" "$err" "$body"
}

nope_path="/k2t-nope-${RANDOM}"
for _ in $(seq 1 "$BURST"); do
  check "www /" "$WWW" "/" "200" "internal" "page"
  check "www /pricing" "$WWW" "/pricing" "200" "internal" "page"
  check "www 404 path" "$WWW" "$nope_path" "404" "internal" "html404"
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
  log_line "$(printf 'www / samples=%s median=%ss p90=%ss' "$(wc -l <"$home_times" | tr -d ' ')" "$median" "$p90")"
  awk -v med="$median" -v p90="$p90" 'BEGIN {
    if (med + 0 > 2.40) { print "FAIL www / median " med "s wanted <= 2.40s" > "/dev/stderr"; exit 1 }
    if (p90 + 0 > 4.813) { print "FAIL www / p90 " p90 "s wanted <= 4.813s" > "/dev/stderr"; exit 1 }
  }' || fail=1
fi

check "public object" "$SITES" "$PUBLIC_PATH" "200" "allow"
check "banned object" "$SITES" "$BANNED_PATH" "403" "blocked" "denied"
check "banned object again" "$SITES" "$BANNED_PATH" "403" "blocked" "denied"
check "banned host" "$BAN" "/" "403" "status" "denied"
check "private object" "$SITES" "$PRIVATE_PATH" "403" "blocked" "denied"
check "public user site" "$PUB" "/" "200" "status"

if [ "$fail" != "0" ]; then
  exit 1
fi
if ! may_print_pass "$REQUIRE_INTERNAL" "$WWW" "$SITES" "$PUB" "$BAN"; then
  echo "refusing to print PASS" >&2
  exit 1
fi
echo "PASS"
