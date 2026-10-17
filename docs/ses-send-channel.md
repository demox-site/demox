# SES 发信通道（腾讯云邮件推送）

2026-10-17 实测。发信域 `mail.demox.site` 已在腾讯云 SES 验证通过，并成功投递到 QQ 邮箱。

本文讲**通道本身**（用哪个域、走哪个接口、有哪些坑）；邮件文案不在这里，见 `docs/ban-notice-mail.md`。

## 一句话现状

能发，但**只能按审核过的模板发**。账号未开通「自定义发送」权限，`SendEmail` 走 `Simple` 直发会被拒：

```
FailedOperation.WithOutPermission  未开通自定义发送权限，必须使用模版发送
```

## 资源清单

| 项 | 值 |
| --- | --- |
| 发信域 | `mail.demox.site`（`DOMAIN` 类型，`SendingEnabled=True`） |
| 发信地址 | `noreply@mail.demox.site` |
| region | `ap-hongkong` |
| 端点 | `ses.tencentcloudapi.com` |
| 同账号其他发信身份 | `mail.aigc.sx.cn`（登录验证码在用，生产已验证） |
| 模板 | `137482` 验证码（已通过，生产在用）、`226012` Demox 站点停用通知（2026-10-17 重建，审核中） |
| 凭据 | 本机 `.workbuddy/ses-test.json`，**不入仓库**；建议用子账号，只给 `ses:SendEmail` / `ses:ListEmailIdentities` / `ses:GetEmailTemplate` |

## DNS（DNSPod，`mail` 子域）

| 主机记录 | 类型 | 值 | 作用 |
| --- | --- | --- | --- |
| `mail` | MX | `1 mxbiz1.qq.com.` | **域名验证用，不是收信**。改了它 SES 发信域会掉验证 |
| `mail` | TXT | `v=spf1 include:qcloudmail.com ~all` | SPF，发信源认证 |
| `_dmarc.mail` | TXT | `v=DMARC1; p=none` | DMARC，观察模式 |
| `qcloud._domainkey.mail` | TXT | （1024 位公钥） | DKIM，旧密钥 |
| `qcloudhk2048._domainkey.mail` | TXT | （2048 位公钥） | DKIM，新密钥，`DKIMOption=2` |

两条容易误判的地方：

1. **SES 只发不收**。`mxbiz1.qq.com` 那条 MX 是验证记录，SES 没有信箱，往这个域发信不会有人收到。收信要另配（见 REQ-28）。
2. **DKIM 现在是双密钥并存，2048 位已生效**。`GetEmailIdentity` 实测 `DKIMOption=2`，五条 Attributes 全部 `Status=true`，1024 与 2048 两把同时有效。香港区域的 2048 selector 是 **`qcloudhk2048`**，不是国内文档常写的 `qcloudsg2048`。旧记录里“建议切 2048”那句已过时。

## 两条发送路径

**Simple（直写正文）** —— 当前不可用，缺「自定义发送」权限。

**Template（模板）** —— 当前唯一可用路径。模板先审后发，正文只能填变量。

```python
import json
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.ses.v20201002 import models, ses_client

hp = HttpProfile(); hp.endpoint = "ses.tencentcloudapi.com"
cp = ClientProfile(); cp.httpProfile = hp
client = ses_client.SesClient(credential.Credential(SID, KEY), "ap-hongkong", cp)

req = models.SendEmailRequest()
req.FromEmailAddress = "noreply@mail.demox.site"
req.Destination = ["user@example.com"]
req.Subject = "【Demox】站点 10086 已停用，可申诉"      # 主题不占模板，可自定义
req.Template = {
    "TemplateID": 226012,
    "TemplateData": json.dumps({"siteId": "10086", "siteName": "...", "reason": "...", "replyDays": "3"}, ensure_ascii=False),
}
req.ReplyToAddresses = "phosa@qq.com"                   # 申诉回信落点，见下
client.SendEmail(req)
```

## 模板审核规则（官方）

出处：<https://cloud.tencent.com/document/product/1288/52777>

- 通知类 / 事务类 / 测试类**至少 50 字**，营销类至少 150 字
- 变量与文字比例 **不超过 1:5**，不支持全变量模板
- **禁止出现 URL 和跳转链接**
- 禁止「加 QQ、加微信、加群」、返利、抽奖等
- 审核时效：**工作日**提交，1 个工作日内；休息日提交顺延到下一个工作日

## 接口坑（都是实测踩到的）

| 现象 | 原因 |
| --- | --- |
| `InvalidParameterValue.TemplateContentIsWrong 请检查base64内容是否正确` | `CreateEmailTemplate` / `GetEmailTemplate` 的 `TemplateContent` 是 **base64**，不是原文 |
| `ListEmailTemplates` 解析出 0 条但 `TotalCount=1` | 返回字段名是 `TemplatesMetadata`，不是 `Templates` |
| `FailedOperation.InvalidTemplateID 模板ID无效或者不可用` | 模板在**审核中**（`TemplateStatus=1`）同样不能发，只能等 |
| `GetSendEmailStatus` 报 `取值类型错误，参数类型应为 string` | `MessageId` 传**字符串**，不是数组 |
| `GetSendEmailStatus` 报 `请求缺少必传参数 Limit` / `RequestDate` | 三个都必传：`RequestDate`（`YYYY-MM-DD`）、`Limit`、`Offset` |
| `AuthFailure.SecretIdNotFound` | 密钥被**删除或禁用**都会这么报，腾讯云故意不区分；换 region 试没用，是密钥本身的问题 |
| 模板 `TemplateStatus=0`、`GetEmailTemplate` 内容完好，`SendEmail` 仍报 `InvalidTemplateID` | **审核结果没同步到发信侧**。实测这种状态下报的错与“根本不存在的模板 ID”一字不差。API 里没有任何启用/发布接口，等同步或重建模板 |
| `ListEmailAddress` 报 `UnknownParameter 未定义参数 Imit` | 服务端把 `Limit` 解析成了 `Imit`，SDK 3.1.135 仍复现。这个接口当前不可用，绕开 |

`TemplateStatus`：`0` 通过、`1` 审核中（`2` 拒绝、`3` 待提交）。

## 投递状态字段

`GetSendEmailStatus` 返回 `SendStatus` 和 `DeliverStatus`，判成功要看后者：

- `SendStatus=0` 发送成功
- `DeliverStatus=1` 投递成功（另有失败、未回执等取值）

## 实测记录（2026-10-17 22:51）

一封借用验证码模板的信，`noreply@mail.demox.site` → `phosa@qq.com`：

```
MessageId      qcloudses-30-1307257815-date-20261017225113-Vo43BAMsGWTS1
SendStatus     0        发送成功
DeliverStatus  1        投递成功
DeliverTime    22:51:16
```

结论：发信域、SPF、DKIM、DMARC 这条链路是通的，**域配置不需要再动**。

## Reply-To 实测（2026-10-17 23:03）

一封借用验证码模板的信，`From: noreply@mail.demox.site` + `ReplyToAddresses: phosa@qq.com`，在 QQ 邮箱里点“回复”，收件人栏确实是 `phosa@qq.com` —— **Reply-To 生效**。

但这条不能当成 100% 保证：

- Reply-To 是 RFC 5322 的标准头，主流客户端（QQ 邮箱、Gmail、Outlook）都遵守，但**不是协议强制**。少数老客户端或企业客户端会忽略它、直接回 `From`
- 忽略 Reply-To 时，回复会发到 `noreply@mail.demox.site`。而 **SES 只发不收**，这封信会被退，且退给发信人，我们这边看不到 —— **静默失败**
- 跨组织域的 Reply-To（`mail.demox.site` → `qq.com`）在部分反垃圾规则里是负面信号，影响进箱率

所以 Reply-To 指个人邮箱只适合过渡。终局是收信子域建好后，正文写 `appeal@...` 且 Reply-To 同主域，双保险——正文加邮箱需要模板重新送审，等 REQ-28 定了再一次性改。

## 未完成

- 模板 `226012` 审核中（2026-10-17 周六重建，最早 2026-10-19 周一）。前一条 `226011` 的情况值得记下：`TemplateStatus=0`、控制台也显示审核通过、确认没有启用开关，但发送侧始终报 `InvalidTemplateID`，报错与“根本不存在的模板 ID”完全一致，已删除重建。**226012 通过后第一件事是实发验证**——能用说明是审核结果同步问题，仍不能用则是账号级问题，直接提工单
- 「自定义发送」权限未申请。申请则不再受模板审批约束，但腾讯云要求说明业务场景与发信量级，个人主体未必能过
- 发信代码仍指向 `noreply@mail.aigc.sx.cn` + 模板 `137482`，切到 demox 需改代码（发件地址、模板号读环境变量，禁止硬编码）。见 `docs/tencent-cloud.md`、REQ-26
- 收信链路未定，见 REQ-28
