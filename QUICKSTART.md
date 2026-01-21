# 🚀 快速开始

本文档介绍如何快速部署和测试 Demox MCP 服务。

## 一键部署

### Linux / macOS

```bash
# 完整部署（推荐）
./deploy.sh

# 或跳过某些步骤
./deploy.sh --skip-db              # 跳过数据库初始化
./deploy.sh --skip-functions       # 跳过云函数部署
./deploy.sh --skip-frontend-build  # 跳过前端构建
./deploy.sh --skip-frontend-deploy # 跳过前端部署

# 查看帮助
./deploy.sh --help
```

### Windows

```cmd
REM 完整部署（推荐）
deploy.bat

REM 或跳过某些步骤
deploy.bat --skip-db
deploy.bat --skip-functions
deploy.bat --skip-frontend-build
deploy.bat --skip-frontend-deploy

REM 查看帮助
deploy.bat --help
```

## 手动部署

如果一键部署失败，可以手动执行以下步骤：

### 步骤 1: 安装依赖

```bash
# MCP Server 依赖
cd mcp-server
npm install
cd ..

# 项目根目录依赖（如果需要）
npm install
```

### 步骤 2: 构建 MCP Server

```bash
cd mcp-server
npm run build
cd ..
```

### 步骤 3: 初始化数据库

```bash
node scripts/init-oauth-db.js
```

### 步骤 4: 部署云函数

```bash
# 安装 CloudBase CLI（如果未安装）
npm install -g @cloudbase/cli

# 登录 CloudBase
cloudbase login

# 部署 OAuth 云函数
cloudbase functions:deploy oauth-token-manager

# 更新部署云函数
cloudbase functions:deploy deploy-website
```

### 步骤 5: 构建和部署前端

```bash
# 构建前端
npm run build

# 部署到静态托管
cloudbase hosting deploy dist
```

## 测试

### 1. 测试 MCP Server

```bash
cd mcp-server

# 方式 1: 使用 CLI
npm run cli -- test

# 方式 2: 直接运行
node dist/cli.js test

# 方式 3: 使用 MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

### 2. 测试前端

访问 `https://demox.site/#/mcp-setup`

### 3. 端到端测试

1. 下载配置文件
2. 导入到 Claude Desktop 或 Cursor
3. 重启 AI 工具
4. 尝试部署一个测试网站

## 常见问题

### 问题 1: Node.js 版本过低

**错误信息**：
```
Error: Node.js version too old
```

**解决方案**：
```bash
# 使用 nvm 安装 Node.js 18+
nvm install 18
nvm use 18
```

### 问题 2: CloudBase CLI 未安装

**错误信息**：
```
cloudbase: command not found
```

**解决方案**：
```bash
npm install -g @cloudbase/cli
cloudbase login
```

### 问题 3: 云函数部署失败

**可能原因**：
- 未登录 CloudBase
- 环境不存在
- 权限不足

**解决方案**：
```bash
# 检查登录状态
cloudbase auth list

# 查看环境列表
cloudbase env list

# 切换到正确的环境
cloudbase env switch moyu-3g5pbxld00f4aead
```

### 问题 4: 数据库初始化失败

**错误信息**：
```
Error: DATABASE_COLLECTION_NOT_EXIST
```

**解决方案**：
- 集合会自动创建，首次运行时忽略此错误
- 或在 CloudBase 控制台手动创建集合

### 问题 5: 构建失败

**错误信息**：
```
TypeScript error
```

**解决方案**：
```bash
# 清理并重新构建
cd mcp-server
rm -rf dist node_modules
npm install
npm run build
```

## 验证部署

### 检查清单

- [ ] MCP Server 构建成功（dist 目录存在）
- [ ] 云函数部署成功（oauth-token-manager, deploy-website）
- [ ] 数据库集合创建成功
- [ ] 前端部署成功
- [ ] 可以访问 MCP 配置页面
- [ ] CLI 工具可以运行

### 快速验证命令

```bash
# 验证 MCP Server 构建
ls -la mcp-server/dist/

# 验证云函数
cloudbase functions:list

# 验证数据库（在 CloudBase 控制台查看）

# 验证前端
curl -I https://demox.site

# 验证 CLI
cd mcp-server && npm run cli -- --version
```

## 下一步

部署成功后：

1. **配置 MCP 客户端**
   - 访问 https://demox.site/#/mcp-setup
   - 下载配置文件
   - 导入到 AI 工具

2. **测试基本功能**
   - 登录: `demox-mcp login`
   - 测试: `demox-mcp test`
   - 查看列表: `demox-mcp list`

3. **部署第一个网站**
   ```bash
   # 准备测试网站
   echo "<h1>Hello Demox!</h1>" > index.html
   zip -r test.zip index.html

   # 部署
   demox-mcp deploy ./test.zip --name "Test Site"
   ```

4. **集成到 AI 工具**
   - 在 Claude Desktop 中尝试
   - 在 Cursor 中尝试
   - 查看文档了解更多用法

## 需要帮助？

- 📖 [完整文档](mcp-server/README.md)
- 📚 [使用示例](mcp-server/EXAMPLES.md)
- ❓ [常见问题](mcp-server/FAQ.md)
- 📧 [联系支持](mailto:support@demox.site)

---

祝你部署顺利！🎉
