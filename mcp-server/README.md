# @demox/mcp-server

[![npm version](https://badge.fury.io/js/%40demox%2Fmcp-server.svg)](https://www.npmjs.com/package/@demox/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Demox MCP Server - 通过 AI 部署静态网站到 Demox 平台

## 📖 目录

- [什么是 MCP？](#什么是-mcp)
- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [配置步骤](#配置步骤)
- [CLI 工具](#cli-工具)
- [可用工具](#可用工具)
- [使用示例](#使用示例)
- [文档](#文档)
- [常见问题](#常见问题)
- [技术支持](#技术支持)

---

## 什么是 MCP？

MCP (Model Context Protocol) 是 AI 助手与工具之间的标准化协议，允许 AI 工具（如 Claude Code、Cursor）安全地调用外部服务。

## 功能特性

- 🚀 **一键部署**: 部署静态网站到 Demox 平台
- 📋 **网站管理**: 查看、删除已部署的网站
- 🔐 **OAuth 认证**: 安全的登录和授权机制
- 💻 **AI 集成**: 与 Claude Code、Cursor 等工具无缝集成
- 🛠️ **CLI 工具**: 完整的命令行工具支持
- 🔄 **自动刷新**: Token 自动续期，无需重复登录

---

## 快速开始

### 安装

**方式 1: 使用 npx（推荐）**
```bash
# 无需安装，自动使用最新版本
npx @demox/mcp-server
```

**方式 2: 全局安装**
```bash
npm install -g @demox/mcp-server
```

### 快速测试

```bash
# 登录
demox-mcp login

# 测试连接
demox-mcp test

# 查看网站列表
demox-mcp list
```

---

## 配置步骤

### 1. 生成配置文件

访问 [Demox MCP 配置页面](https://demox.site/#/mcp-setup) 下载配置文件。

或使用 CLI 生成：

```bash
demox-mcp config -o demox-mcp.json
```

### 2. 导入配置

根据您使用的 AI 工具，将配置导入到相应位置：

#### Claude Desktop

**macOS**:
```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**:
```bash
%APPDATA%/Claude/claude_desktop_config.json
```

配置示例：
```json
{
  "mcpServers": {
    "demox": {
      "command": "npx",
      "args": ["-y", "@demox/mcp-server"],
      "env": {
        "DEMOX_CLIENT_ID": "demox-mcp-client",
        "DEMOX_AUTH_URL": "https://demox.site/mcp/authorize",
        "DEMOX_API_BASE": "https://demox.site",
        "DEMOX_SERVER_ENV": "moyu-3g5pbxld00f4aead"
      }
    }
  }
}
```

#### Cursor AI

**macOS / Linux**: `~/.cursor/mcp.json`
**Windows**: `%APPDATA%/Cursor/mcp.json`

#### Cline (VS Code 插件)

所有平台: `~/.cline/mcp.json`

### 3. 重启 AI 工具

配置完成后，重启您的 AI 工具。

### 4. 首次使用

首次调用 MCP 工具时，会自动打开浏览器登录。

登录成功后，凭证会保存在本地（`~/.demox/token.json`），有效期 30 天。

---

## CLI 工具

安装 MCP Server 后，可以使用 `demox-mcp` CLI 工具：

```bash
# 登录
demox-mcp login

# 查看状态
demox-mcp status

# 列出网站
demox-mcp list

# 部署网站（支持自动打包！）
demox-mcp deploy ./dist              # 自动打包目录 ✨
demox-mcp deploy ./site.zip          # 直接上传 ZIP
demox-mcp deploy ./dist --name "My Site"  # 指定名称
demox-mcp deploy ./dist --id ABC12345 # 更新现有网站

# 删除网站
demox-mcp delete ABC12345

# 测试连接
demox-mcp test

# 生成配置文件
demox-mcp config

# 登出
demox-mcp logout
```

**✨ 新功能**：`deploy` 命令现在支持直接传入目录路径（如 `./dist`），系统会自动打包并部署！

---

## 可用工具

### deploy_website

部署静态网站到 Demox 平台。

**参数**:
- `zipFile` (string, 必需): ZIP 文件内容（base64 编码或 URL）
- `fileName` (string, 必需): 网站名称
- `websiteId` (string, 可选): 网站 ID（更新现有网站）

### list_websites

获取所有网站列表。

### get_website

获取指定网站的详细信息。

**参数**:
- `websiteId` (string, 必需): 网站 ID

### delete_website

删除指定的网站。

**参数**:
- `websiteId` (string, 必需): 网站 ID

---

## 使用示例

### 在 Claude Desktop 中

```
用户: 部署 dist 目录到 Demox

Claude: 好的，我来帮您部署 dist 目录。

[检测到目录，自动打包...]

✅ 网站部署成功！
网站名称: dist
访问地址: https://demox.site/xxx
```

### 在 Cursor 中

```
# 在 Cursor 的 Chat 中输入

部署当前项目到 Demox

# Cursor 会自动：
# 1. 检测到项目目录（如 ./dist）
# 2. 自动打包成 ZIP
# 3. 上传并部署
# 4. 返回访问链接
```

### 使用 CLI

```bash
# 方式 1: 部署目录（自动打包）✨
demox-mcp deploy ./dist

# 方式 2: 部署 ZIP 文件
demox-mcp deploy ./site.zip

# 方式 3: 指定网站名称
demox-mcp deploy ./dist --name "My Portfolio"

# 方式 4: 更新现有网站
demox-mcp deploy ./dist --id ABC12345
```

### 编程方式

```typescript
import { DemoxClient, OAuthManager } from "@demox/mcp-server";

const oauthManager = new OAuthManager();
const accessToken = await oauthManager.ensureAuthenticated();
const client = new DemoxClient(accessToken);

// 部署网站
const result = await client.deployWebsite(
  {
    zipFile: "./site.zip",
    fileName: "My Site",
  },
  accessToken
);

console.log("部署成功:", result.url);
```

更多示例请查看 [EXAMPLES.md](EXAMPLES.md)。

---

## 文档

- **[使用示例](EXAMPLES.md)**: 详细的使用场景和代码示例
- **[常见问题](FAQ.md)**: 常见问题和解决方案
- **[部署指南](../DEPLOYMENT.md)**: 服务器部署指南

---

## 常见问题

### Token 过期怎么办？

Token 有效期为 30 天，过期后会自动弹出浏览器重新登录。

### 如何撤销授权？

```bash
demox-mcp logout
```

或删除本地 Token 文件：
```bash
rm ~/.demox/token.json
```

### 支持哪些 AI 工具？

- Claude Desktop / Claude Code
- Cursor AI
- Cline (VS Code 插件)
- 其他支持 MCP 协议的工具

### 多台设备可以使用吗？

可以。每台设备需要单独登录，互不影响。

### 如何查看调试日志？

```bash
# 启用调试模式
DEBUG=demox:* demox-mcp test
```

更多问题请查看 [FAQ.md](FAQ.md)。

---

## 技术支持

- 📖 **文档**: https://docs.demox.site
- 🐛 **Issues**: https://github.com/demox/mcp-server/issues
- 📧 **邮箱**: support@demox.site

---

## 开发

### 本地开发

```bash
# 克隆项目
git clone https://github.com/demox/mcp-server.git
cd mcp-server

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 运行 CLI
npm run cli -- --help
```

### 贡献

欢迎贡献代码！请查看 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 许可证

[MIT License](LICENSE)

---

Made with ❤️ by Demox Team
