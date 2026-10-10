#!/usr/bin/env bash
# 边缘函数 subdomain-router（ef-1281msyw）发布后的 P0 核对。每一项都跑两遍：不带 cookie、带假的 demox_access。
# 任何一项失败 → exit 1，按 AGENTS.md「P0 禁令」立刻 ModifyFunction 回上一份 Content。
#
# 2026-10-10 17:18–17:23 事故：#49 的 edge 只在「不带 cookie」时核对通过；带 demox_access 的真实用户
# 访问公开站点全是 503、www 是 404。所以带 cookie 的那一遍不能省。
#
# 用法（默认对生产，只读 GET/POST，不写任何东西）：
#   scripts/edge-p0-check.sh
# 可覆盖：
#   WWW_URL=https://www.demox.site/
#   SITE_URLS="https://coverage.demox.site/ https://uv0fkz31.demox.site/"   # 至少一个真实公开站点
#   UNBOUND_URL=https://your-demo.demox.site/                               # 未绑定 host，期望 404
#   FN_URL=https://uv0fkz31.demox.site/api/cookies                          # 探针函数（只回显 cookie 名），可留空跳过
#   POST_URLS=https://uv0fkz31.demox.site/                                  # 页面 POST 也要 200（探针站），可留空跳过
#   SKIP_WWW=1                                                              # 预发（只绑测试 host）时跳过 www / 未绑定 host
set -u
WWW_URL=${WWW_URL:-https://www.demox.site/}
SITE_URLS=${SITE_URLS:-"https://coverage.demox.site/ https://uv0fkz31.demox.site/"}
UNBOUND_URL=${UNBOUND_URL:-https://your-demo.demox.site/}
FN_URL=${FN_URL-https://uv0fkz31.demox.site/api/cookies}
POST_URLS=${POST_URLS-https://uv0fkz31.demox.site/}
SKIP_WWW=${SKIP_WWW:-0}
FAKE='demox_access=p0-fake-not-a-token; p0_probe=1'
fail=0
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

req() { # method url cookie(optional) → sets CODE, BODY file, HDR file
  local m=$1 u=$2 c=${3:-}
  local args=(-s -m 30 -o "$tmp/body" -D "$tmp/hdr" -w '%{http_code}' -X "$m" -H 'Cache-Control: no-cache')
  [ -n "$c" ] && args+=(-H "Cookie: $c")
  [ "$m" = POST ] && args+=(-H 'Content-Type: application/json' --data '{"p0":true}')
  sep='?'; case $u in *\?*) sep='&';; esac
  CODE=$(curl "${args[@]}" "${u}${sep}p0=$(date +%s)$RANDOM")
  ROUTE=$(tr -d '\r' < "$tmp/hdr" | awk -F': ' 'tolower($1)=="x-demox-route"{print $2}')
}
check() { # label expect-code [body-must-not-match-regex]
  local label=$1 exp=$2 bad=${3:-}
  local ok=1
  [ "$CODE" = "$exp" ] || ok=0
  if [ -n "$bad" ] && grep -Eq "$bad" "$tmp/body"; then ok=0; fi
  if [ $ok = 1 ]; then echo "PASS $label → $CODE ${ROUTE:+($ROUTE)}"; else echo "FAIL $label → $CODE (want $exp) ${ROUTE:+($ROUTE)}"; fail=1; fi
}

for variant in nocookie cookie; do
  c=''; [ $variant = cookie ] && c=$FAKE
  tag="[$variant]"
  if [ "$SKIP_WWW" != 1 ]; then
    req GET "$WWW_URL" "$c"; check "$tag GET www $WWW_URL" 200 '页面不存在|站点未发布|暂时无法访问|Page Not Found'
    grep -q 'id="root"' "$tmp/body" || { echo "FAIL $tag www body is not the main site"; fail=1; }
  fi
  for s in $SITE_URLS; do
    req GET "$s" "$c"; check "$tag GET site $s" 200 '站点未发布|暂时无法访问|需要重新验证'
  done
  for s in $POST_URLS; do
    req POST "$s" "$c"; check "$tag POST site $s" 200 '站点未发布|暂时无法访问|需要重新验证'
  done
  if [ -n "$FN_URL" ]; then
    for m in GET POST; do
      req $m "$FN_URL" "$c"; check "$tag $m fn $FN_URL" 200
      grep -q 'demox_access' "$tmp/body" && { echo "FAIL $tag $m fn saw demox_access"; fail=1; }
      [ $variant = cookie ] && ! grep -q 'p0_probe' "$tmp/body" && { echo "FAIL $tag $m fn lost the site's own cookie"; fail=1; }
    done
  fi
  if [ "$SKIP_WWW" != 1 ]; then
    req GET "$UNBOUND_URL" "$c"; check "$tag GET unbound $UNBOUND_URL" 404
  fi
done

if [ $fail = 0 ]; then echo "P0 OK (with and without demox_access)"; else echo "P0 FAILED → roll back ef-1281msyw now"; fi
exit $fail
