# 独立证书续期函数 `demox-cert-job`

目标：证书续期离开网关 `demox-function-api`，自带 CAM 与定时器。旧 `demox-cert-renew` 仍只作回滚，不要更新它。

## 云上（磷 UIN `100021031865`）

| 资源 | 值 |
|------|-----|
| 函数 | `demox` / `demox-cert-job`（Event，Nodejs18.15，`index.main`，256MB / 300s） |
| 角色 | `demox-cert-job-role` |
| 策略 | `demox-cert-job-policy`（SSL 上传/读、EO 绑证、DNSPod TXT、`scf:Get/UpdateCustomDomain`、`scf:GetFunction` 供绑定校验、CLS） |
| 定时器 | `monthly-renew` → qualifier **`production`**，cron `0 17 3 1 * * *`，**Enable=1** |
| 别名 | `production` → 已发布版本 |

环境变量从网关拷贝（无值进仓库）：`ACME_EMAIL`、`EDGEONE_ZONE_ID`、`RENEW_THRESHOLD_DAYS`、`CERT_DOMAIN`、`CERT_SAN`、`DNSPOD_DOMAIN`。`SCF_CUSTOM_DOMAIN` 不能经 API 写入（SCF_ 前缀保留），代码默认 `api.demox.site`。

## 网关定时器

磷 `demox-function-api` 的 `monthly-renew` 应 **Enable=0**（保留触发器便于回滚）。易点侧异常 `$LATEST` / 嵌套 cron 定时器应删除，且不要与磷双边同时开启。

## 代码后续

统一包与 `system-functions.json` 仍可暂时含 cert-renew，直到确认独立函数稳定后再从网关 zip / 进程内路由删掉，并去掉网关上的 ACME/EDGEONE/RENEW 环境名。

## 冒烟

`Invoke` qualifier `production`，`ClientContext` 带 `TriggerName=monthly-renew`。未到窗口应返回 `success:true` / `path:not-due`，不要为验证强制签发。
