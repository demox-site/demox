# 飞书登录配置与发布

Demox 使用飞书 OAuth 2.0 授权码流程，并启用 PKCE（S256）。系统只读取基础用户信息
`open_id`、`union_id`、姓名和头像，不申请通讯录邮箱权限，也不保存飞书
`user_access_token` 或 `refresh_token`。

## 1. 配置飞书应用

1. 在飞书开放平台创建或选择自建应用，并启用网页应用能力。
2. 在应用的安全设置中添加重定向 URL：

   ```text
   https://www.demox.site/feishu-callback
   ```

3. 将应用可用范围覆盖需要登录 Demox 的用户，并完成应用发布/安装。
4. 基础登录不需要额外申请通讯录权限；如果授权 URL 后续增加 `scope`，必须先在应用后台开通对应权限。

重定向 URL 必须与前端和 auth-api 使用的值完全一致，否则飞书换取 token 时会返回
`20071`。

## 2. 迁移数据库

在 auth-api 使用的 MySQL 数据库执行：

```text
scf-deploy-packages/auth-api/migrations/001_add_feishu_identity.sql
```

迁移增加 `feishu_open_id`、`feishu_union_id` 和 `feishu_name`，并对两个身份标识建立唯一约束。

## 3. 配置并发布 auth-api

在 auth-api SCF 环境变量中配置：

```text
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_REDIRECT_URI=https://www.demox.site/feishu-callback
```

`FEISHU_APP_SECRET` 只允许存在于 SCF 环境变量中，不得写入仓库、前端变量或构建日志。
完成配置后，单独发布 `scf-deploy-packages/auth-api/` 对应的认证云函数；主站的 GitHub
Actions 只发布静态前端，不会更新 auth-api。

## 4. 配置并发布前端

在 GitHub Actions Variables 中增加：

```text
VITE_FEISHU_APP_ID=cli_xxx
VITE_FEISHU_REDIRECT_URI=https://www.demox.site/feishu-callback
```

`VITE_FEISHU_REDIRECT_URI` 可省略，前端会默认使用
`${VITE_DEMOX_SITE_URL}/feishu-callback`。App ID 是公开标识，可以进入前端构建；App Secret
不可以。

代码推送到 `master` 后，现有工作流会构建和发布主站。

## 5. 上线验证

至少验证以下路径：

1. 首次飞书授权后选择“创建新账号”，能够进入项目控制台。
2. 首次飞书授权后选择“关联已有账号”，验证已有账号后能够完成绑定。
3. 已绑定飞书用户再次登录，能够直接进入原 Demox 账号。
4. 飞书拒绝授权、回调 `state` 不匹配、PKCE 丢失时均被拒绝。
5. 私有站点登录入口能够完成 OAuth 并回到原站点。
6. 账号设置页能够显示绑定状态；未设置密码时拒绝解绑，避免账号失去登录入口。

前端构建、auth-api 发布和数据库迁移只证明代码已就位；必须完成至少一次真实飞书账号授权，才能确认生产登录闭环。
