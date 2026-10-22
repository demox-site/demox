#!/usr/bin/env bash
# 边缘写入前记 baseline，写入后核对。失败由 edge-deploy.cjs 写回上一份代码。
set -euo pipefail
phase="${1:-check}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
baseline="${EDGE_BASELINE:?EDGE_BASELINE is required}"

if [ "$phase" = "baseline" ]; then
  python3 scripts/edge-p0-matrix.py baseline "$baseline"
  exit 0
fi

if [ "$phase" != "check" ]; then
  echo "unknown probe phase: $phase" >&2
  exit 1
fi

BASELINE="$baseline" bash scripts/edge-p0-check.sh
python3 scripts/edge-reentry-probe.py https://www.demox.site/ https://www.demox.site/pricing
python3 scripts/ci/edge-private-probe.py
node scripts/ci/release-smoke.cjs
