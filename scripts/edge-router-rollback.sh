#!/usr/bin/env bash
# Roll the edge router back to a previous published Content, verify, then forward again.
#
# This is the same release path as scf-code/deploy-edge-functions.sh:
#   tccli teo ModifyFunction --ZoneId zone-3kplfkbflnd6 --FunctionId ef-1281msyw \
#     --Content "$(cat <file>)" --region ap-guangzhou
# There is no second publisher. The script does not print function Content.
#
#   scripts/edge-router-rollback.sh plan
#   PREVIOUS=edge-functions/subdomain-router.prev.js APPLY=1 scripts/edge-router-rollback.sh drill
#   scripts/edge-router-rollback.sh self-test
#
# plan (default) prints the tccli shape and sha256 only. drill writes only when APPLY=1.
# PREVIOUS is a file, or a git rev whose edge-functions/subdomain-router.js is the previous publish.
# Verification is scripts/edge-p0-check.sh (www + one real site, with and without the fake cookie).
set -euo pipefail

ZONE_ID=zone-3kplfkbflnd6
FUNCTION_ID=ef-1281msyw
REGION=ap-guangzhou
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUTER="$ROOT/edge-functions/subdomain-router.js"
ACTION="${1:-plan}"

sha() { sha256sum "$1" | awk '{print $1}'; }

modify_argv() {
  printf 'tccli teo ModifyFunction --ZoneId %s --FunctionId %s --region %s --Content-File %s\n' \
    "$ZONE_ID" "$FUNCTION_ID" "$REGION" "$1"
}

run_modify() {
  local file="$1"
  if [ "${TCCLI_BIN:-tccli}" = "tccli" ]; then
    tccli teo ModifyFunction --ZoneId "$ZONE_ID" --FunctionId "$FUNCTION_ID" \
      --Content "$(cat "$file")" --region "$REGION" >/dev/null
  else
    "$TCCLI_BIN" teo ModifyFunction --ZoneId "$ZONE_ID" --FunctionId "$FUNCTION_ID" \
      --Content-File "$file" --region "$REGION" >/dev/null
  fi
}

save_live() {
  local dest="$1"
  if [ "${TCCLI_BIN:-tccli}" = "tccli" ]; then
    tccli teo DescribeFunctions --ZoneId "$ZONE_ID" --region "$REGION" >"$dest.raw"
  else
    "$TCCLI_BIN" teo DescribeFunctions --ZoneId "$ZONE_ID" --region "$REGION" >"$dest.raw"
  fi
  node - "$dest.raw" "$dest" "$FUNCTION_ID" <<'JS'
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const body = raw.Response || raw;
const list = body.Functions || body.FunctionList || [];
const found = list.find((item) => item.FunctionId === process.argv[4]);
if (!found || typeof found.Content !== 'string' || !found.Content) {
  console.error('DescribeFunctions did not return Content for ' + process.argv[4]);
  process.exit(1);
}
fs.writeFileSync(process.argv[3], found.Content);
JS
  rm -f "$dest.raw"
}

verify() {
  if [ -n "${VERIFY_CMD:-}" ]; then
    bash -c "$VERIFY_CMD"
    return
  fi
  bash "$ROOT/scripts/edge-p0-check.sh"
}

resolve_previous() {
  local spec="${PREVIOUS:-}"
  if [ -z "$spec" ]; then
    echo "PREVIOUS is required (file path or git rev)" >&2
    exit 2
  fi
  if [ -f "$spec" ]; then
    printf '%s\n' "$spec"
    return
  fi
  local tmp
  tmp="$(mktemp)"
  git -C "$ROOT" show "${spec}:edge-functions/subdomain-router.js" >"$tmp"
  printf '%s\n' "$tmp"
}

plan() {
  echo "edge router rollback plan"
  echo "function: $FUNCTION_ID"
  echo "zone: $ZONE_ID"
  echo "region: $REGION"
  echo "current file: $ROUTER"
  echo "current sha256: $(sha "$ROUTER")"
  modify_argv "$ROUTER"
  if [ -n "${PREVIOUS:-}" ]; then
    local prev
    prev="$(resolve_previous)"
    echo "previous sha256: $(sha "$prev")"
    modify_argv "$prev"
  fi
  echo "verify: scripts/edge-p0-check.sh (www 200, one real site 200, with and without demox_access)"
  echo "drill writes only when APPLY=1"
}

drill() {
  if [ "${APPLY:-0}" != "1" ]; then
    echo "refusing to ModifyFunction without APPLY=1" >&2
    plan
    exit 2
  fi
  local work prev live
  work="$(mktemp -d)"
  trap "rm -rf $(printf '%q' "$work")" EXIT
  live="$work/live.js"
  save_live "$live"
  prev="$(resolve_previous)"
  local live_sha prev_sha
  live_sha="$(sha "$live")"
  prev_sha="$(sha "$prev")"
  echo "live sha256: $live_sha"
  echo "previous sha256: $prev_sha"
  if [ "$live_sha" = "$prev_sha" ]; then
    echo "previous content matches live; nothing to roll" >&2
    exit 2
  fi
  echo "step 1/4 ModifyFunction previous"
  run_modify "$prev"
  echo "step 2/4 verify previous"
  local verify_rc=0
  verify || verify_rc=$?
  # Step 3 puts the saved live content back. set -e must not skip the retry:
  # a failed ModifyFunction here would otherwise leave PREVIOUS live.
  attempt_restore() {
    echo "step 3/4 ModifyFunction live again"
    if run_modify "$live"; then
      return 0
    fi
    echo "step 3/4 ModifyFunction live failed; retrying once" >&2
    if run_modify "$live"; then
      return 0
    fi
    echo "LIVE NOT RESTORED" >&2
    return 1
  }
  trap 'attempt_restore || true' ERR
  if ! attempt_restore; then
    trap - ERR
    exit 1
  fi
  trap - ERR
  echo "step 4/4 verify live"
  verify
  if [ "$verify_rc" != "0" ]; then
    echo "verification of the previous content failed; live content was restored" >&2
    exit 1
  fi
  echo "ROLLBACK DRILL OK"
}

self_test() {
  local work stub log
  work="$(mktemp -d)"
  trap "rm -rf $(printf '%q' "$work")" EXIT
  log="$work/calls"
  printf 'live-function-body\n' >"$work/live.js"
  printf 'previous-function-body\n' >"$work/previous.js"
  cat >"$work/tccli" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >>"$TCCLI_LOG"
if [ "$1" = "teo" ] && [ "$2" = "DescribeFunctions" ]; then
  node -e 'const fs=require("fs"); const body=fs.readFileSync(process.env.LIVE_FILE,"utf8"); process.stdout.write(JSON.stringify({Response:{Functions:[{FunctionId:process.env.FUNCTION_ID,Content:body}]}}));'
  exit 0
fi
if [ "$1" = "teo" ] && [ "$2" = "ModifyFunction" ]; then
  case "$*" in
    *live.js*)
      if [ -n "${FAIL_LIVE_LIMIT:-}" ] && [ "${FAIL_LIVE_LIMIT:-0}" -gt 0 ]; then
        n=0
        if [ -n "${FAIL_COUNT_FILE:-}" ] && [ -f "$FAIL_COUNT_FILE" ]; then
          n=$(cat "$FAIL_COUNT_FILE")
        fi
        n=$((n + 1))
        if [ -n "${FAIL_COUNT_FILE:-}" ]; then
          printf '%s\n' "$n" >"$FAIL_COUNT_FILE"
        fi
        if [ "$n" -le "$FAIL_LIVE_LIMIT" ]; then
          echo "simulated live modify failure" >&2
          exit 1
        fi
      fi
      ;;
  esac
  exit 0
fi
echo "unexpected tccli $*" >&2
exit 1
SH
  chmod +x "$work/tccli"
  LIVE_FILE="$work/live.js" FUNCTION_ID="$FUNCTION_ID" TCCLI_LOG="$log" \
    TCCLI_BIN="$work/tccli" PREVIOUS="$work/previous.js" APPLY=1 \
    VERIFY_CMD="echo verified >>\"$log\"" \
    bash "$ROOT/scripts/edge-router-rollback.sh" drill
  node - "$log" <<'JS'
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
const modifies = lines.filter((line) => line.includes('ModifyFunction'));
const verifies = lines.filter((line) => line.startsWith('verified'));
if (modifies.length !== 2) {
  console.error('expected 2 ModifyFunction calls, got ' + modifies.length);
  process.exit(1);
}
if (!modifies[0].includes('previous.js') || !modifies[1].includes('live.js')) {
  console.error('round trip order was not previous then live');
  process.exit(1);
}
if (verifies.length !== 2) {
  console.error('expected verification after each ModifyFunction');
  process.exit(1);
}
if (lines.some((line) => line.includes('live-function-body') || line.includes('previous-function-body'))) {
  console.error('function content was written into the call log');
  process.exit(1);
}
JS
  run_case() {
    local name="$1"
    local limit="$2"
    local log="$work/calls-$name"
    local fails="$work/fails-$name"
    : >"$log"
    rm -f "$fails"
    LIVE_FILE="$work/live.js" FUNCTION_ID="$FUNCTION_ID" TCCLI_LOG="$log" \
      FAIL_COUNT_FILE="$fails" FAIL_LIVE_LIMIT="$limit" \
      TCCLI_BIN="$work/tccli" PREVIOUS="$work/previous.js" APPLY=1 \
      VERIFY_CMD="echo verified >>\"$log\"" \
      bash "$ROOT/scripts/edge-router-rollback.sh" drill
  }
  run_case retry 1 >"$work/retry.out" 2>"$work/retry.err"
  if grep -q "LIVE NOT RESTORED" "$work/retry.err"; then
    echo "a successful retry must not raise LIVE NOT RESTORED" >&2
    exit 1
  fi
  node - "$work/calls-retry" <<'JS'
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
const modifies = lines.filter((line) => line.includes('ModifyFunction'));
const verifies = lines.filter((line) => line.startsWith('verified'));
if (modifies.length !== 3) {
  console.error('expected previous plus one failed live restore and one retry, got ' + modifies.length);
  process.exit(1);
}
if (!modifies[0].includes('previous.js') || !modifies[1].includes('live.js') || !modifies[2].includes('live.js')) {
  console.error('retry order was not previous, live, live');
  process.exit(1);
}
if (verifies.length !== 2) {
  console.error('expected verification after the rolled-back publish and after the restored live publish');
  process.exit(1);
}
JS
  set +e
  run_case bothfail 2 >"$work/both.out" 2>"$work/both.err"
  both_rc=$?
  set -e
  if [ "$both_rc" = "0" ]; then
    echo "two failed live restores must not succeed" >&2
    exit 1
  fi
  if ! grep -q "LIVE NOT RESTORED" "$work/both.err"; then
    echo "two failed live restores must print LIVE NOT RESTORED" >&2
    exit 1
  fi
  node - "$work/calls-bothfail" <<'JS'
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
const modifies = lines.filter((line) => line.includes('ModifyFunction'));
if (modifies.length !== 3) {
  console.error('expected previous plus two failed live restores, got ' + modifies.length);
  process.exit(1);
}
if (!modifies.every((line, index) => line.includes(index === 0 ? 'previous.js' : 'live.js'))) {
  console.error('double-failure order was not previous then two live attempts');
  process.exit(1);
}
JS
  APPLY=0 TCCLI_BIN="$work/tccli" bash "$ROOT/scripts/edge-router-rollback.sh" drill && {
    echo "drill without APPLY=1 must refuse" >&2
    exit 1
  }
  echo "ROLLBACK SELF-TEST OK"
}

case "$ACTION" in
  plan) plan ;;
  drill) drill ;;
  self-test) self_test ;;
  *) echo "usage: $0 plan|drill|self-test" >&2; exit 2 ;;
esac
