# Demox

[English Version](./README_EN.md)

> 上传前端构建产物，立刻获得一个公网可访问的网站链接。

🚀 **立即使用 Demox** → https://demox.site/  
📦 无需配置 · 无需服务器 · 无需 CDN 设置

---

## Demox 是什么？

**Demox 是一个已经上线可用的静态网站部署平台。**

它为前端开发者解决一个非常直接的问题：

> 👉 前端已经 build 好了，  
> 👉 怎么最快给别人一个能访问的链接？

Demox 不要求你了解对象存储、CDN、HTTPS、缓存策略，  
也不需要你维护服务器或编写部署脚本。

你只需要上传一个 `.zip` 文件，  
Demox 会自动完成剩下的一切。

---

## 🚀 如何使用（30 秒上手）

1. 在本地构建你的前端项目  
   例如 `npm run build`，生成 `dist/` 目录
2. 将构建产物打包为一个 `.zip` 文件
3. 上传到 Demox
4. **立刻获得一个可公网访问的站点地址**

### 上传方式

| 方式 | 说明 |
|------|------|
| **Web 控制台** | 打开 [demox.site](https://demox.site)，登录后直接拖拽上传 |
| **CLI** | 命令行一键部署，适合 CI/CD 集成 |
| **MCP Server** | 在 Claude Code / Cursor 等 AI 工具中直接部署 |
| **API** | 通过 REST API 程序化部署 |

---

## 🎯 Demox 适合哪些场景？

> Demox 不是用来取代 Netlify 或 Vercel，
> 而是当你现在就需要一个能打开的链接时。

Demox 专注解决「**快速交付**」的问题，尤其适合：

- 前端 Demo / 作品展示
- Landing Page / 活动页
- 向客户、同事、朋友分享页面
- 独立开发者快速上线想法
- 团队内部预览与评审
- 将 PDF、Markdown、DOCX 文档一键转为可分享的网页

如果你的目标只是：

> **"给我一个能打开的链接"**

那 Demox 就是最省事的选择。

---

## 📦 工具链

Demox 提供完整的部署工具链，满足不同场景：

### CLI 命令行工具

```bash
# 安装
npm install -g @demox-site/cli@latest

# 登录
demox login

# 部署
demox deploy ./dist

# 部署文档（PDF、Markdown、DOCX 自动转网页）
demox deploy ./document.pdf
demox deploy ./notes.md --template warm
```

更多用法见 [CLI README](../cli/README.md)。

### MCP Server（AI 工具集成）

在 Claude Code、Cursor 等 AI 工具中直接部署：

```json
{
  "mcpServers": {
    "demox": {
      "command": "npx",
      "args": ["-y", "@demox-site/mcp-server@latest"],
      "env": {
        "DEMOX_SITE_URL": "https://demox.site",
        "DEMOX_API_URL": "https://your-api-url"
      }
    }
  }
}
```

更多用法见 [MCP Server README](../mcp-server/README.md)。

### API Token

在控制台 → 设置 → API Token 中生成 Token，用于脚本或 CI/CD 调用。

---

## 🗂️ 项目与站点管理

### 项目（Projects）

将多个站点按项目分组管理，方便归类和批量操作。

### 自定义子域名

为站点设置专属子域名前缀：

```
https://my-demo.demox.site
```

在控制台或 CLI 中即可设置，无需配置 DNS。

### 站点可见性

- **公开**：任何人可通过链接访问
- **私有**：仅登录用户可访问（适合内部预览）

---

## 🤔 为什么不自己部署？

当然，你可以自己搭一套：

- 对象存储
- CDN
- 域名与 HTTPS
- 缓存策略
- 权限与限额
- 防滥用
- 流量与成本统计

但这些事情往往：

- 碎
- 多
- 容易出错
- 一次配置，长期维护

Demox 的价值在于：

> **这些运维级问题，已经被一次性解决。**

使用 Demox，你默认就拥有：

- 🌍 独立访问域名 + CDN 加速
- 🔒 HTTPS 自动启用
- ⚡ 合理的缓存策略
  - HTML 永不缓存，确保更新即时生效
  - JS / CSS / 图片长期缓存，性能最优
- 🧯 服务端鉴权与限额控制
- 📊 基础流量与成本感知

你可以把精力全部放在前端本身。

---

## 👥 谁在使用 Demox？

- 前端开发者（React / Vue / 任意静态站点）
- 独立开发者 / Indie Hacker
- 不想维护服务器与部署流程的人
- 想快速把页面交付出去的人
- 团队内部预览与评审

Demox 并不试图替代复杂的 CI/CD，  
而是让「发布一个页面」这件事变得极其简单。

---

## 🔐 稳定性与安全性

Demox 不是玩具项目，而是**工程化的平台实现**：

- 所有部署、删除、重部署操作均在服务端完成
- 所有限额与权限校验不依赖前端
- 站点按用户与项目完全隔离
- 防目录穿越、防非法文件结构
- 上传内容经过 COS 内容安全审核
- 支持随时下线与清理站点
- 站点私有访问控制（登录后可见）
- 独立子域名路由与 SPA 回退

这是一个可以**长期使用**的服务。

---

## 🧩 支持的文件类型

| 类型 | 说明 |
|------|------|
| 目录 | 自动打包为 ZIP |
| ZIP | 直接上传 |
| PDF | 自动生成预览网页 |
| Markdown | 自动套模板生成网页 |
| TXT | 自动套模板生成网页 |
| DOCX | 自动转为网页 |

文档模板支持：`insight`、`warm`、`dark`（通过 `--template` 参数选择）。

---

## 🧠 背后的实现（可选阅读）

Demox 构建在腾讯云生态之上：

- **SCF（云函数）**：鉴权、用户体系与所有核心业务逻辑
- **MySQL（TencentDB）**：用户、站点与权限数据
- **COS（对象存储）**：静态资源托管
- **EdgeOne**：CDN、HTTPS、泛域名访问与边缘路由

云函数负责所有核心逻辑，包括：

- 鉴权与角色校验
- 部署与重部署
- 站点管理与项目管理
- 自定义子域名路由
- 流量统计
- 基础成本估算

边缘函数（Edge Function）负责：

- `*.demox.site` 子域名路由解析
- 私有站点访问控制
- SPA 回退（按 Accept 头区分导航与静态资源）
- "Powered by Demox" 标识注入

这是一个真实上线、真实可运营的系统设计。

---

## 📦 关于开源

Demox 的源码是开放的，用于：

- 提供平台透明度
- 供开发者学习和参考架构设计

需要说明的是：

> **源码并不是即插即用模板。**

项目深度依赖腾讯云 SCF、MySQL、COS、EdgeOne 等服务。  
如果你只是想使用 Demox，**推荐直接使用官方平台版本**。

---

## 📄 License

- 代码协议以仓库声明为准
- 欢迎学习、参考与二次开发
- 不承诺 fork 后可直接运行

---

## ✨ 一句话总结

> **Demox 解决的不是"怎么部署前端"，  
> 而是"如何最快把页面交付出去"。**

🚀 **立即使用** → https://demox.site/
