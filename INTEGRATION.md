# 🚀 demox.site MCP 服务接入指南

本指南将帮助你完成 MCP 服务在 demox.site 项目中的接入和部署。

---

## 📋 接入清单

在开始之前，请确认以下内容：

- [ ] CloudBase 环境已创建
- [ ] CloudBase CLI 已安装
- [ ] 项目根目录访问权限
- [ ] 云函数部署权限

---

## 第一步：准备 MCP 配置信息

### 1.1 环境信息确认

demox.site 项目的关键信息：

```yaml
域名: demox.site
环境 ID: moyu-3g5pbxld00f4aead
静态托管: https://demox.site
MCP 配置页面: https://demox.site/#/mcp-setup
```

### 1.2 OAuth 客户端信息

```json
{
  "clientId": "demox-mcp-client",
  "authUrl": "https://demox.site/mcp/authorize",
  "apiBase": "https://demox.site"
}
```

---

## 第二步：初始化数据库

### 2.1 安装项目依赖

```bash
cd mcp-server
npm install
```

### 2.2 初始化 OAuth 数据库

```bash
# 返回项目根目录
cd ..

# 运行数据库初始化脚本
node scripts/init-oauth-db.js
```

这将创建以下集合：
- `oauth_clients` - OAuth 客户端配置
- `oauth_auth_codes` - 授权码
- `oauth_refresh_tokens` - 刷新令牌
- `mcp_sessions` - 会话记录
- `oauth_audit_log` - 审计日志

---

## 第三步：部署云函数

### 3.1 登录 CloudBase

```bash
cloudbase login
```

### 3.2 切换到正确环境

```bash
cloudbase env switch moyu-3g5pbxld00f4aead
```

### 3.3 部署 OAuth Token 管理云函数

```bash
cloudbase functions:deploy cloudfunctions/oauth-token-manager
```

**预期输出**：
```
[OK] 部署成功
函数名称: oauth-token-manager
```

### 3.4 更新现有部署云函数

```bash
cloudbase functions:deploy cloudfunctions/deploy-website
```

---

## 第四步：构建和部署前端

### 4.1 构建前端项目

```bash
npm run build
```

### 4.2 部署到静态托管

```bash
cloudbase hosting deploy dist
```

### 4.3 验证部署

访问以下 URL 确认部署成功：
- 主页：https://demox.site
- MCP 配置页：https://demox.site/#/mcp-setup
- OAuth 登录页：https://demox.site/#/mcp-login

---

## 第五步：配置 AI 工具

### 5.1 Claude Desktop / Claude Code

#### macOS 配置文件位置

```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

#### Windows 配置文件位置

```bash
%APPDATA%/Claude/claude_desktop_config.json
```

#### 配置内容

```json
{
  "mcpServers": {
    "demox": {
      "command": "npx",
      "args": ["-y", "@demox/mcp-server@latest"],
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

### 5.2 Cursor AI

#### 配置文件位置

- **macOS / Linux**: `~/.cursor/mcp.json`
- **Windows**: `%APPDATA%/Cursor/mcp.json`

#### 配置内容

```json
{
  "demox": {
    "command": "npx",
    "args": ["-y", "@demox/mcp-server@latest"],
    "env": {
      "DEMOX_CLIENT_ID": "demox-mcp-client",
      "DEMOX_AUTH_URL": "https://demox.site/mcp/authorize"
    }
  }
}
```

### 5.3 重启 AI 工具

配置完成后，必须重启 AI 工具才能生效：

**macOS**:
```bash
killall Claude
# 或
killall Cursor
```

**Windows**:
```cmd
taskkill /F /IM Claude.exe
taskkill /F /IM Cursor.exe
```

---

## 第六步：测试 MCP 服务

### 6.1 使用 CLI 工具测试

```bash
cd mcp-server

# 测试连接
npm run cli -- test

# 或使用全局命令
npm link
demox-mcp test
```

### 6.2 首次登录

首次使用会自动打开浏览器登录：

```bash
demox-mcp login
```

或通过 AI 工具触发任意 MCP 操作，会自动弹出登录页面。

### 6.3 部署测试网站

创建一个简单的测试文件：

```bash
# 创建测试目录
mkdir test-site
echo "<h1>Hello Demox!</h1>" > test-site/index.html

# 部署
demox-mcp deploy ./test-site --name "Test Site"
```

预期输出：
```
✅ 部署成功！

网站名称: Test Site
网站 ID: ABC12345
访问地址: https://demox.site/ABC12345
```

---

## 第七步：在 AI 工具中使用

### 7.1 Claude Desktop 使用示例

```
用户: 帮我部署 dist 目录

Claude: 我来帮您部署 dist 目录。

[自动检测目录、打包、上传]

✅ 网站部署成功！

网站名称: dist
访问地址: https://demox.site/xxx

您可以访问上述地址查看您的网站了。
```

### 7.2 Cursor 使用示例

```
# 在 Cursor Chat 中输入

部署当前项目的 dist 目录

Cursor 会自动：
1. 检测到 dist 目录
2. 自动打包成 ZIP
3. 上传到 Demox 平台
4. 返回访问链接
```

---

## 🔍 验证清单

部署完成后，使用以下清单验证：

### 云函数验证

```bash
# 查看已部署的云函数
cloudbase functions:list

# 应该看到：
# - oauth-token-manager
# - deploy-website
```

### 数据库验证

在 CloudBase 控制台查看：
- `oauth_clients` 集合存在
- 至少有 1 个客户端记录（`demox-mcp-client`）

### 前端页面验证

- ✅ 主页可以访问
- ✅ MCP 配置页面可以访问：`/#/mcp-setup`
- ✅ 页面样式正常，无 JavaScript 错误

### MCP 工具验证

```bash
# 测试 CLI
demox-mcp test

# 测试登录
demox-mcp login

# 测试列表
demox-mcp list
```

---

## 📱 用户使用流程

### 对于 demox.site 的用户

1. **访问配置页面**
   ```
   https://demox.site/#/mcp-setup
   ```

2. **下载配置文件**
   - 点击"下载配置文件"按钮
   - 获得 `demox-mcp.json` 文件

3. **导入到 AI 工具**
   - Claude Desktop: 编辑配置文件
   - Cursor: 编辑配置文件

4. **重启 AI 工具**

5. **开始使用**
   - 在 AI 工具中说："部署 dist 目录"
   - 系统自动完成打包和部署

---

## 🎯 核心特性

### ✨ 自动打包
- 只需提供目录路径（如 `./dist`）
- 系统自动打包成 ZIP
- 无需手动操作

### 🔐 安全认证
- OAuth 2.0 标准认证
- Token 自动刷新（30天有效）
- 支持多设备

### 💻 AI 集成
- Claude Desktop / Claude Code
- Cursor AI
- 其他 MCP 协议工具

---

## 🐛 常见问题

### Q1: 云函数部署失败

**A**: 检查以下几点：

```bash
# 1. 确认已登录
cloudbase auth list

# 2. 确认环境正确
cloudbase env list

# 3. 检查云函数日志
cloudbase functions:log oauth-token-manager
```

### Q2: 前端部署后页面 404

**A**: 检查路由配置：

确认 `src/configs/routers.ts` 中包含：
```typescript
{
  id: "mcp-setup",
  component: MCPSetup
},
{
  id: "mcp-login",
  component: MCPLogin
},
{
  id: "mcp-authorize",
  component: MCPAuthorize
}
```

### Q3: MCP 工具调用失败

**A**: 排查步骤：

1. **检查配置文件**：确认 JSON 格式正确
2. **重启 AI 工具**：配置后必须重启
3. **查看日志**：
   - Claude Desktop: 查看控制台日志
   - Cursor: 查看开发者工具

### Q4: Token 过期问题

**A**:
- Token 有效期 30 天
- 过期后自动弹出浏览器重新登录
- 或手动运行：`demox-mcp login`

---

## 📞 技术支持

如遇到问题，可以：

1. **查看日志**
   ```bash
   # CloudBase 日志
   cloudbase functions:log oauth-token-manager
   cloudbase functions:log deploy-website
   ```

2. **查看文档**
   - `mcp-server/README.md`
   - `mcp-server/FAQ.md`
   - `mcp-server/EXAMPLES.md`

3. **联系支持**
   - 📧 Email: support@demox.site
   - 🐛 Issues: GitHub Issues

---

## ✅ 快速接入命令

如果你已经完成了之前的步骤，只需要快速配置：

```bash
# 1. 构建 MCP Server
cd mcp-server
npm run build
cd ..

# 2. 部署云函数
cloudbase functions:deploy cloudfunctions/oauth-token-manager
cloudbase functions:deploy cloudfunctions/deploy-website

# 3. 部署前端
npm run build
cloudbase hosting deploy dist

# 4. 测试
cd mcp-server
npm run cli -- test
```

---

## 🎉 完成！

MCP 服务已成功接入到 demox.site 项目！

用户现在可以：
1. 访问 https://demox.site/#/mcp-setup 下载配置
2. 配置到 AI 工具中
3. 一键部署网站

**开始使用吧！** 🚀
