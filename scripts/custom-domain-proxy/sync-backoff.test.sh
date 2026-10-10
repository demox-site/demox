#!/usr/bin/env bash
# Unit test for the ACME failure backoff in sync.sh (no root, no network).
# Run: bash scripts/custom-domain-proxy/sync-backoff.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
sed -n '/^# --- acme backoff: begin/,/^# --- acme backoff: end/p' "$here/sync.sh" >"$tmp/backoff.sh"
grep -q acme_in_backoff "$tmp/backoff.sh" || { echo "FAIL: backoff block not found"; exit 1; }

ACME_FAIL_DIR="$tmp/fail"; mkdir -p "$ACME_FAIL_DIR"
ACME_MANUAL_MIN_SECS=900; CERT_WARN_DAYS=25; FILTER_HOST=""
NOW=1000000
date() { if [[ "${1:-}" == "+%s" ]]; then echo "$NOW"; else command date "$@"; fi; }
# shellcheck disable=SC1091
source "$tmp/backoff.sh"

fails=0
ok() { echo "ok - $1"; }
bad() { echo "not ok - $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

h=fail.example.com
check "fresh domain is not in backoff" '! acme_in_backoff $h >/dev/null'
acme_record_failure $h >/dev/null
check "state file records count 1" '[[ "$(cat $ACME_FAIL_DIR/$h)" == "1 1000000" ]]'
NOW=$((1000000 + 3599)); check "1st failure: skipped within 1h" 'acme_in_backoff $h | grep -q "backoff after 1 failed"'
NOW=$((1000000 + 3600)); check "1st failure: retried after 1h" '! acme_in_backoff $h >/dev/null'
acme_record_failure $h >/dev/null; last=$NOW
NOW=$((last + 21599)); check "2nd failure: skipped within 6h" 'acme_in_backoff $h >/dev/null'
NOW=$((last + 21600)); check "2nd failure: retried after 6h" '! acme_in_backoff $h >/dev/null'
for _ in 1 2 3 4 5 6 7; do acme_record_failure $h >/dev/null; done; last=$NOW
check "backoff caps at 7 days" '[[ "$(acme_backoff_secs 9)" == 604800 ]]'
NOW=$((last + 604799)); check "9th failure: skipped within 7 days" 'acme_in_backoff $h >/dev/null'
FILTER_HOST=$h
NOW=$((last + 899)); check "--host run: still skipped within 15 min" 'acme_in_backoff $h >/dev/null'
NOW=$((last + 900)); check "--host run: retried after 15 min" '! acme_in_backoff $h >/dev/null'
FILTER_HOST=""
acme_clear_failures $h
check "success clears state" '[[ ! -e $ACME_FAIL_DIR/$h ]] && ! acme_in_backoff $h >/dev/null'
printf 'garbage\n' >"$ACME_FAIL_DIR/$h"
check "corrupt state file treated as no failures" '! acme_in_backoff $h >/dev/null'
check "missing cert: no expiry warning" '[[ -z "$(warn_if_cert_expiring nope.example 2>&1)" ]]'

[[ "$fails" -eq 0 ]] && echo "# all passed" || { echo "# $fails failed"; exit 1; }
