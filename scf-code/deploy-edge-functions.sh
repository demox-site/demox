#!/usr/bin/env bash
#
# 自定义子域名前缀功能 —— 部署记录 / 重建参考(非一键脚本)
# ===========================================================================
# 已于 2026-06-12 部署并端到端验证通过。访问 {label}.demox.site 命中对应站点。
# 2026-06 新增官方域名池设计：{label}.vibeme.cn 也走同一套 label+domain 查表。
#
# 最终架构(不用 KV):
#   - 路由表 = MySQL websites.subdomain + websites.subdomain_domain(联合唯一索引)。
#   - 边缘函数 subdomain-router 接管 *.demox.site / *.vibeme.cn:
#       · 旧格式 sites-{userId}-{fileId}-{dir} 走内置正则(老站点零改动)
#       · 自定义前缀 {label} → fetch website-api /resolve-subdomain 查 path
#         → 回源 sites.demox.site/{path}/{uri};解析结果走边缘 Cache 60s。
#   - website-api 新增 set_subdomain / clear_subdomain(鉴权)+ resolve_subdomain(公开)。
#
# 为什么不用 KV:
#   用户的 KV 命名空间(ns- 格式 + API token)是 EdgeOne Pages KV;
#   而本 zone(demox.site)的边缘函数是标准版(addEventListener 模型),
#   两条产品线 KV 不互通——诊断确认运行时 env/全局里都拿不到绑定。
#   标准版边缘函数支持 fetch 子请求,故改用 website-api + 边缘 Cache 查表。
#
# 已部署的线上资源:
#   - 边缘函数 subdomain-router = ef-1281msyw
#   - 触发规则 rule-fxfyqmn5(host=*.demox.site)指向 ef-1281msyw
#     (原指向老函数 ef-7ej45f3q;ef-7ej45f3q 代码未改,留作回滚)
#   - website-api(SCF demox-website-api / lam-ixkn6jpq)已含新 action
#   - DB:websites.subdomain + subdomain_domain 列 + uniq_official_subdomain 索引
#
# 回滚:把 rule-fxfyqmn5 的 FunctionId 改回 ef-7ej45f3q:
#   tccli teo ModifyFunctionRule --ZoneId zone-3kplfkbflnd6 \
#     --RuleId rule-fxfyqmn5 --FunctionId ef-7ej45f3q --region ap-guangzhou
#
# 更新边缘函数代码:
#   tccli teo ModifyFunction --ZoneId zone-3kplfkbflnd6 --FunctionId ef-1281msyw \
#     --Content "$(cat edge-functions/subdomain-router.js)" --region ap-guangzhou
#
# 更新 website-api:下载线上包作底座覆盖 index.js 重打包(详见会话记录),
#   scf-deploy-packages/ 目录是过期垃圾,勿用。
#
# 关键坑(已记入项目记忆 custom-domain-feature):
#   - 标准版边缘函数读环境变量用 env.XXX,不是裸全局。
#   - EdgeOne 不允许两条规则同 host 条件(DuplicateRule),只能改指向不能新建。
#   - 函数专属域名 <name>.eo-edgefunctions.com 可直连调试,绕过触发规则。
#
# 收尾可做(可选):删除 website-api 的临时 migrate_subdomain action 和 MIGRATION_KEY 环境变量。
echo "这是部署记录文档,非可执行脚本。详见文件内注释。"
