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
#   SITE_URLS="https://coverage.demox.site/ https://uv0fkz31.demox.site/ https://letters-from-the-hill.demox.site/"
#       # 至少一个真实公开站点；这三个都在 site-3 源站（COS 按 Host 找桶，2026-10-10 17:52 带 cookie 时 400）
#       # 每个站点页面：带 cookie 的正文长度和 sha256 必须和不带时一样（只看 200 不够）
#   UNBOUND_URL=https://your-demo.demox.site/                               # 未绑定 host，期望 404
#   FN_URL=https://uv0fkz31.demox.site/api/cookies                          # 探针函数（只回显 cookie 名），可留空跳过
#   POST_URLS=https://uv0fkz31.demox.site/                                  # 页面 POST 也要 200（探针站），可留空跳过
#   SKIP_WWW=1                                                              # 预发（只绑测试 host）时跳过 www / 未绑定 host
#   BASELINE=/path/baseline.json   # 必填（生产发布时）：发布前用 `python3 scripts/edge-p0-matrix.py baseline OUT.json`
#                                  # 在旧代码上记一份（GET/HEAD/POST/PUT/OPTIONS × www/coverage/uv0fkz31/letters-from-the-hill/函数）；
#                                  # 发布后带 cookie 逐项比状态码 + 正文 sha256，并检查两条过期 Set-Cookie、函数看不到 demox_access。
# 源站路径（K0，发布后才有意义；本脚本不部署）：
#   ORIGIN_HOSTS="sites.demox.site site-3.demox.site"
#   BANNED_PATHS="sites/<uid>/<ID>/dist/index.html ..."   # 封禁 → 403（或连接被拒绝）
#   PRIVATE_PATHS="sites/<uid>/<ID>/..."                  # 不写死私有站点 uid；未设置则跳过
#   PUBLIC_PATHS="sites/<uid>/<ID>/dist/index.html ..."   # 公开 → 200
#   BANNED_OLD_URL=https://sites.demox.site/sites/<uid>/VMPZGKSR/dist/index.html  # 封禁旧站对象：GET/POST/OPTIONS 都 403
#   MISSING_OLD_URL=https://sites.demox.site/sites/<uid>/ZZZZZZZZ/dist/index.html # 不存在的旧站对象：GET/POST/OPTIONS 都 404
#   ASSET_URLS="https://www.demox.site/assets/index-*.js https://www.demox.site/assets/index-*.css"
#       # 2026-11-04 www 白屏（AE 被带进子请求，curl 92）：每个资源 --compressed 用 br、gzip 各取一次，
#       # 必须 curl exit 0、200、解码后字节数 == Accept-Encoding: identity 的字节数。未设置时从 www 首页里取。
#   FIRST_SCREEN_BUDGET_MS=3000
#   ENFORCE_SITE_N=1    # site-N 今天不经 EdgeOne。默认只记录 GAP，不因此失败；K3 之后设 1
#   SKIP_ORIGIN=1       # 只跑本地封禁缓存模拟，不请求源站
#   P0_RESOLVE_IP=1.2.3.4  # 或 --resolve-ip 1.2.3.4：每个 curl 都加 --resolve host:443/80:IP，直连 EdgeOne 节点，
#       # 绕开本机代理（2026-11-04 云帆经代理拿到 http 500/超时）。不设置时行为不变。只作用于本脚本的 curl，不作用于 edge-p0-matrix.py。
# D0 重入探测（只读，不需要密钥）：python3 scripts/edge-reentry-probe.py https://www.demox.site/
# D2 现场矩阵（封禁 ID、公开站、http2 Host/:authority、缓存键大小写、CORS、15s）：python3 scripts/edge-p0-matrix.py d2
# 性能：python3 scripts/edge-p0-matrix.py perf-baseline before.json，发布后再 python3 scripts/edge-p0-matrix.py perf before.json
# 回滚来回：scripts/edge-router-rollback.sh plan ；APPLY=1 才写，见 skills/edge-router/SKILL.md
# 每个源站 host × path 都会打 http 和 https。site-N 的 https 证书不匹配只记一笔，不单独失败。
set -u
P0_RESOLVE_IP=${P0_RESOLVE_IP:-}
while [ $# -gt 0 ]; do
  case $1 in
    --resolve-ip) P0_RESOLVE_IP=${2:?--resolve-ip needs an IP}; shift 2 ;;
    --resolve-ip=*) P0_RESOLVE_IP=${1#*=}; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -n "$P0_RESOLVE_IP" ]; then
  # 包一层 curl：把参数里每个 http(s) URL 的主机都钉到 P0_RESOLVE_IP。
  curl() {
    local a h port extra=()
    for a in "$@"; do
      case $a in
        https://*|http://*)
          h=${a#*://}; h=${h%%[/?#]*}
          case $a in https://*) port=443 ;; *) port=80 ;; esac
          case $h in *:*) port=${h##*:}; h=${h%:*} ;; esac
          extra+=(--resolve "$h:$port:$P0_RESOLVE_IP") ;;
      esac
    done
    command curl "${extra[@]}" "$@"
  }
  echo "INFO every curl pinned to $P0_RESOLVE_IP via --resolve"
fi
WWW_URL=${WWW_URL:-https://www.demox.site/}
SITE_URLS=${SITE_URLS:-"https://coverage.demox.site/ https://uv0fkz31.demox.site/ https://letters-from-the-hill.demox.site/"}
UNBOUND_URL=${UNBOUND_URL:-https://your-demo.demox.site/}
FN_URL=${FN_URL-https://uv0fkz31.demox.site/api/cookies}
POST_URLS=${POST_URLS-https://uv0fkz31.demox.site/}
SKIP_WWW=${SKIP_WWW:-0}
P0_UID=${P0_UID:-1985655011013808129}
BANNED_OLD_URL=${BANNED_OLD_URL-https://sites.demox.site/sites/$P0_UID/VMPZGKSR/dist/index.html}
MISSING_OLD_URL=${MISSING_OLD_URL-https://sites.demox.site/sites/$P0_UID/ZZZZZZZZ/dist/index.html}
ASSET_URLS=${ASSET_URLS-}
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
    if [ $variant = cookie ]; then
      n=$(tr -d '\r' < "$tmp/hdr" | grep -ciE '^set-cookie: demox_access=; Max-Age=0')
      [ "$n" -ge 2 ] && echo "PASS $tag expiry Set-Cookie x$n $s" || { echo "FAIL $tag expiry Set-Cookie missing ($n) $s"; fail=1; }
    fi
    key=$(printf %s "$s" | sha256sum | cut -c1-16)
    len=$(wc -c < "$tmp/body"); sum=$(sha256sum "$tmp/body" | cut -c1-16)
    if [ $variant = nocookie ]; then
      echo "$len $sum" > "$tmp/ref-$key"
    else
      read -r rlen rsum < "$tmp/ref-$key"
      if [ "$len $sum" = "$rlen $rsum" ]; then echo "PASS $tag body equal $s (len $len sha $sum)"; else echo "FAIL $tag body differs $s (cookie len $len sha $sum vs no-cookie len $rlen sha $rsum)"; fail=1; fi
    fi
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

# 旧站对象：封禁 403、不存在 404。三种方法一致（守卫先裁决，OPTIONS 不能绕过）。
for m in GET POST OPTIONS; do
  if [ -n "$BANNED_OLD_URL" ]; then req $m "$BANNED_OLD_URL"; check "$m banned-old $BANNED_OLD_URL" 403; fi
  if [ -n "$MISSING_OLD_URL" ]; then req $m "$MISSING_OLD_URL"; check "$m missing-old $MISSING_OLD_URL" 404; fi
done

# Accept-Encoding：资源用 br / gzip 取，解码后必须和 identity 一样大。curl 92（流被重置）= 白屏回归。
if [ "$SKIP_WWW" != 1 ]; then
  if [ -z "$ASSET_URLS" ]; then
    home=$(curl -s -m 30 -H 'Accept-Encoding: identity' "$WWW_URL")
    for a in $(printf %s "$home" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.(js|css)' | sort -u); do
      ASSET_URLS="$ASSET_URLS ${WWW_URL%/}$a"
    done
  fi
  [ -n "$ASSET_URLS" ] || { echo "FAIL no /assets/index-*.js|css found on $WWW_URL"; fail=1; }
  for a in $ASSET_URLS; do
    ref=$(curl -s -m 60 -o "$tmp/asset-id" -w '%{http_code}' -H 'Accept-Encoding: identity' "$a"); rc=$?
    idlen=$(wc -c < "$tmp/asset-id")
    if [ $rc != 0 ] || [ "$ref" != 200 ]; then echo "FAIL AE=identity $a → exit $rc code $ref"; fail=1; continue; fi
    for e in br gzip; do
      code=$(curl -s -m 60 --compressed -H "Accept-Encoding: $e" -o "$tmp/asset-$e" -w '%{http_code}' "$a"); rc=$?
      len=$(wc -c < "$tmp/asset-$e" 2>/dev/null || echo 0)
      if [ $rc = 0 ] && [ "$code" = 200 ] && [ "$len" = "$idlen" ]; then
        echo "PASS AE=$e $a → exit 0, 200, decoded $len == identity $idlen"
      else
        echo "FAIL AE=$e $a → exit $rc, code $code, decoded $len vs identity $idlen"; fail=1
      fi
    done
  done
fi

# 2026-11-04 云帆：去 AE 重建后 Cookie 和 body 仍到源站。无令牌透传的未知 host 在公网上不可达，
# 用回显 Cookie 名的站点函数（FN_URL）做可观测替身：带 AE 和不带 AE，GET/POST 都要看到 p0_cookie。
if [ -n "$FN_URL" ]; then
  for m in GET POST; do
    for e in identity 'gzip, deflate, br'; do
      if [ $m = POST ]; then d=(--data '{"p0":"cookie-probe"}' -H 'Content-Type: application/json'); else d=(); fi
      code=$(curl -s -m 20 --compressed -X $m "${d[@]}" -H "Accept-Encoding: $e" -H 'Cookie: p0_cookie=1' -o "$tmp/fn-ck" -w '%{http_code}' "$FN_URL"); rc=$?
      if [ $rc = 0 ] && [ "$code" = 200 ] && grep -q '"p0_cookie"' "$tmp/fn-ck"; then
        echo "PASS cookie reaches origin $m AE=$e $FN_URL"
      else
        echo "FAIL cookie reaches origin $m AE=$e $FN_URL → exit $rc code $code body $(head -c 120 "$tmp/fn-ck")"; fail=1
      fi
    done
  done
fi

if [ -n "${BASELINE:-}" ]; then
  python3 "$(dirname "$0")/edge-p0-matrix.py" compare "$BASELINE" || fail=1
else
  echo "WARN BASELINE not set: method matrix vs baseline skipped (required for production releases)"
fi

# K0：本地模拟「封禁和解封都在 15s 内生效，过期后解析失败是 503」。不访问网络。
python3 "$(dirname "$0")/edge-p0-matrix.py" simulate-ban || fail=1
if [ "${SKIP_ORIGIN:-0}" != 1 ]; then
  python3 "$(dirname "$0")/edge-p0-matrix.py" origin || fail=1
fi

if [ $fail = 0 ]; then echo "P0 OK (with and without demox_access)"; else echo "P0 FAILED → roll back ef-1281msyw now"; fi
exit $fail
