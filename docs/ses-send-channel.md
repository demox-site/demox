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
| 模板 | `137482` 验证码（已通过）、`226011` Demox 站点停用通知（2026-10-17 提交，审核中） |
| 凭据 | 本机 `.workbuddy/ses-test.json`，**不入仓库**；建议用子账号，只给 `ses:SendEmail` / `ses:ListEmailIdentities` / `ses:GetEmailTemplate` |

## DNS（DNSPod，`mail` 子域）

| 主机记录 | 类型 | 值 | 作用 |
| --- | --- | --- | --- |
| `mail` | MX | `1 mxbiz1.qq.com.` | **域名验证用，不是收信**。改了它 SES 发信域会掉验证 |
| `mail` | TXT | `v=spf1 include:qcloudmail.com ~all` | SPF，发信源认证 |
| `_dmarc.mail` | TXT | `v=DMARC1; p=none` | DMARC，观察模式 |
| `qcloud._domainkey.mail` | TXT | （1024 位公钥） | DKIM，selector `qcloud` |

两条容易误判的地方：

1. **SES 只发不收**。`mxbiz1.qq.com` 那条 MX 是验证记录，SES 没有信箱，往这个域发信不会有人收到。收信要另配（见 REQ-28）。
2. **DKIM 是 1024 位**，因为发信域建在 2026-07-06 之前。想升 2048 位需要新增 `qcloudsg2048._domainkey.mail`，两把密钥可以并存，不是替换。腾讯云控制台可一键切换。

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
    "TemplateID": 226011,
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

## 未完成

- 模板 `226011` 待审核（2026-10-17 周六提交，最早 2026-10-19 周一）
- 「自定义发送」权限未申请。申请则不再受模板审批约束，但腾讯云要求说明业务场景与发信量级，个人主体未必能过
- 发信代码仍指向 `noreply@mail.aigc.sx.cn` + 模板 `137482`，切到 demox 需改代码（发件地址、模板号读环境变量，禁止硬编码）。见 `docs/tencent-cloud.md`、REQ-26
- 收信链路未定，见 REQ-28
