#!/usr/bin/env bash
#
# 自定义子域名前缀功能 —— EdgeOne 边缘函数半自动部署脚本
# ---------------------------------------------------------------------------
# 实测说明(2026-06-12 已据此手动跑通,FunctionId 见末尾):
#
# 自动完成(用 tccli teo,--output json 已自动剥掉 Response 外层):
#   1. 创建 kv-admin 函数(已存在则跳过,会报 FunctionNameConflict)
#   2. 创建 subdomain-router 函数
#   3. 给 kv-admin 设环境变量 KV_ADMIN_SECRET
#      ⚠ 函数代码里必须用 env.KV_ADMIN_SECRET 读取(不是裸全局变量),否则 545/500
#   4. 路由切换:用 ModifyFunctionRule 把现有规则 rule-fxfyqmn5 的 FunctionId
#      改成 subdomain-router 的 FID。
#      ⚠ 不能 CreateFunctionRule 新建同 host 规则 —— EdgeOne 报 DuplicateRule。
#      回滚:把 rule-fxfyqmn5 的 FunctionId 改回 ef-7ej45f3q(老函数代码没动)。
#
# 后端调 kv-admin:用函数专属域名直连,不依赖触发规则:
#   https://<kv-admin Domain>.eo-edgefunctions.com  (DescribeFunctions 返回的 Domain)
#   ⚠ 精确 host 触发规则(kv-admin.demox.site)对未接入的域名不生效,故用专属域名。
#
# 必须手动做(EdgeOne 没有 KV 绑定的 OpenAPI):
#   - 控制台给 kv-admin 和 subdomain-router 各「拓展服务 → 新增服务绑定」
#     KV 命名空间 ns-rHwjjy513D6S,变量名都填 ROUTES。
#     未绑定时 kv-admin 正确密钥调用会报 "ROUTES is not defined"。
#
# 依赖:tccli 已配置;或导出 TENCENTCLOUD_SECRETID/SECRETKEY 环境变量。
# 用法:
#   KV_ADMIN_SECRET=<你的随机密钥> bash deploy-edge-functions.sh
set -euo pipefail

ZONE_ID="${EDGEONE_ZONE_ID:-zone-3kplfkbflnd6}"
REGION="${TENCENTCLOUD_REGION:-ap-guangzhou}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EF_DIR="$SCRIPT_DIR/../edge-functions"

KV_NS_ID="ns-rHwjjy513D6S"
KV_VAR_NAME="ROUTES"

if [[ -z "${KV_ADMIN_SECRET:-}" ]]; then
  echo "✗ 请先设置环境变量 KV_ADMIN_SECRET(后端与 kv-admin 函数共用的密钥)"
  echo "  例:KV_ADMIN_SECRET=\$(openssl rand -hex 24) bash $0"
  exit 1
fi

teo() { tccli teo "$@" --region "$REGION" --output json; }

echo "==> ZoneId=$ZONE_ID  Region=$REGION"
echo "==> 读取函数代码..."
KV_ADMIN_CODE="$(cat "$EF_DIR/kv-admin.js")"
ROUTER_CODE="$(cat "$EF_DIR/subdomain-router.js")"

# ---- 1. 创建 kv-admin ----
echo "==> 创建 kv-admin 函数..."
KV_ADMIN_FID="$(
  teo CreateFunction \
    --ZoneId "$ZONE_ID" \
    --Name "kv-admin" \
    --Remark "自定义子域名: KV 写入入口(共享密钥保护)" \
    --Content "$KV_ADMIN_CODE" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['FunctionId'])"
)"
echo "    FunctionId=$KV_ADMIN_FID"

# ---- 2. 创建 subdomain-router ----
echo "==> 创建 subdomain-router 函数..."
ROUTER_FID="$(
  teo CreateFunction \
    --ZoneId "$ZONE_ID" \
    --Name "subdomain-router" \
    --Remark "自定义子域名: *.demox.site 路由(查 KV + 兼容旧正则)" \
    --Content "$ROUTER_CODE" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['FunctionId'])"
)"
echo "    FunctionId=$ROUTER_FID"

# ---- 3. kv-admin 环境变量 ----
echo "==> 设置 kv-admin 环境变量 KV_ADMIN_SECRET..."
teo HandleFunctionRuntimeEnvironment \
  --ZoneId "$ZONE_ID" \
  --FunctionId "$KV_ADMIN_FID" \
  --Operation "setEnvironmentVariable" \
  --EnvironmentVariables "[{\"Key\":\"KV_ADMIN_SECRET\",\"Value\":\"$KV_ADMIN_SECRET\",\"Type\":\"string\"}]" \
  > /dev/null
echo "    done"

# ---- 4. subdomain-router 触发规则 host=*.demox.site ----
echo "==> 创建 subdomain-router 触发规则 host=*.demox.site..."
RULE_ID="$(
  teo CreateFunctionRule \
    --ZoneId "$ZONE_ID" \
    --FunctionId "$ROUTER_FID" \
    --FunctionRuleConditions '[{"RuleConditions":[{"Operator":"equal","Target":"host","Values":["*.demox.site"],"IgnoreCase":false}]}]' \
    --Remark "自定义子域名路由(接管 *.demox.site)" \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('RuleId',''))"
)"
echo "    RuleId=$RULE_ID"

# ---- 5. 优先级置顶 ----
# ModifyFunctionRulePriority 用 RuleIds 数组的顺序表示优先级(数组首位优先级最高)。
# 取回当前所有规则,把新规则放最前面。
echo "==> 调整触发规则优先级(新规则置顶)..."
ALL_RULE_IDS="$(
  teo DescribeFunctionRules --ZoneId "$ZONE_ID" \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids=[r['RuleId'] for r in d.get('FunctionRules',[])]
new='$RULE_ID'
ordered=[new]+[i for i in ids if i!=new]
print(json.dumps(ordered))
"
)"
teo ModifyFunctionRulePriority \
  --ZoneId "$ZONE_ID" \
  --RuleIds "$ALL_RULE_IDS" \
  > /dev/null
echo "    优先级顺序: $ALL_RULE_IDS"

cat <<EOF

✓ 自动部分完成。
  kv-admin         FunctionId = $KV_ADMIN_FID
  subdomain-router FunctionId = $ROUTER_FID
  触发规则          RuleId     = $RULE_ID

⚠ 还需在 EdgeOne 控制台手动完成(没有对应 OpenAPI):
  1. 给 kv-admin 和 subdomain-router 两个函数,各「拓展服务 → 新增服务绑定」
     KV 命名空间 = $KV_NS_ID,变量名称 = $KV_VAR_NAME
  2. 给 kv-admin 加一条触发规则(如 host=kv-admin.demox.site),使后端可访问
  3. website-api SCF 配环境变量:
       KV_ADMIN_URL=https://kv-admin.demox.site
       KV_ADMIN_SECRET=<与本次相同的值>

回滚:停用/删除 subdomain-router 的触发规则($RULE_ID),流量立即回到旧函数 ef-7ej45f3q。
EOF
