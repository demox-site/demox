# Demox MCP Server - 使用示例

本文档提供了 Demox MCP Server 的详细使用示例。

## 目录

- [CLI 工具使用](#cli-工具使用)
- [在 Claude Desktop 中使用](#在-claude-desktop-中使用)
- [在 Cursor 中使用](#在-cursor-中使用)
- [编程方式调用](#编程方式调用)
- [常见使用场景](#常见使用场景)

---

## CLI 工具使用

安装 MCP Server 后，可以使用 `demox-mcp` CLI 工具进行快速操作。

### 1. 登录

```bash
# 启动登录流程（会打开浏览器）
demox-mcp login

# 或使用 npx
npx @demox/mcp-server login
```

### 2. 查看状态

```bash
demox-mcp status
```

输出示例：
```
✅ 已登录
用户 ID: xxxxxxxxxxxxxxxxxxxx
客户端 ID: demox-mcp-client
权限范围: website:deploy, website:list, website:delete, website:update
Token 有效期: 28 天
保存位置: /Users/xxx/.demox/token.json
```

### 3. 列出网站

```bash
demox-mcp list
```

输出示例：
```
📋 您的网站列表：

1. My Personal Website
   ID: ABC12345
   URL: https://demox.site/ABC12345
   创建时间: 2025/1/21 10:30:00

2. Project Demo
   ID: XYZ67890
   URL: https://demox.site/XYZ67890
   创建时间: 2025/1/20 15:45:00
```

### 4. 部署网站

```bash
# 部署新网站
demox-mcp deploy ./my-website.zip --name "My Awesome Website"

# 更新现有网站
demox-mcp deploy ./my-website.zip --name "My Awesome Website" --id ABC12345
```

### 5. 删除网站

```bash
demox-mcp delete ABC12345
```

### 6. 测试连接

```bash
demox-mcp test
```

输出示例：
```
正在测试 MCP 服务连接...

1. 测试认证...
   ✅ 认证成功
2. 测试 API 连接...
   ✅ API 连接成功（找到 2 个网站）

✅ 所有测试通过！MCP 服务运行正常。
```

### 7. 生成配置文件

```bash
# 生成默认配置文件
demox-mcp config

# 指定输出文件
demox-mcp config -o my-config.json
```

### 8. 登出

```bash
demox-mcp logout
```

---

## 在 Claude Desktop 中使用

### 配置步骤

1. **找到配置文件位置**

   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

2. **编辑配置文件**

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

3. **重启 Claude Desktop**

   ```bash
   # macOS
   killall Claude

   # Windows
   taskkill /F /IM Claude.exe
   ```

### 使用示例

#### 示例 1：部署本地项目

```
你: 我有一个 React 项目已经打包好了，在 ./dist 目录，帮我部署到 Demox

Claude: 好的，我来帮您部署这个项目。

首先我需要将 dist 目录打包成 ZIP 文件，然后部署...

[调用 deploy_website 工具]

✅ 网站部署成功！

网站名称: React App
网站 ID: ABC12345
访问地址: https://demox.site/ABC12345

您现在可以访问上述地址查看您的网站了。
```

#### 示例 2：查看所有网站

```
你: 显示我所有的网站

Claude: [调用 list_websites 工具]

📋 您的网站列表（共 3 个）

1. **Portfolio 2025**
   - ID: `ABC12345`
   - URL: https://demox.site/ABC12345
   - 创建时间: 2025/1/21 10:30:00

2. **Blog**
   - ID: `DEF67890`
   - URL: https://demox.site/DEF67890
   - 创建时间: 2025/1/15 14:20:00

3. **Landing Page**
   - ID: `GHI13579`
   - URL: https://demox.site/GHI13579
   - 创建时间: 2025/1/10 09:15:00
```

#### 示例 3：更新现有网站

```
你: 帮我更新一下我的 Portfolio 网站，新的文件在 ./new-dist.zip

Claude: 好的，我来更新您的 Portfolio 网站。

[调用 list_websites 查找网站 ID]

[调用 deploy_website 工具，传入 websiteId]

✅ 网站部署成功！

网站名称: Portfolio 2025
网站 ID: ABC12345
访问地址: https://demox.site/ABC12345

您的 Portfolio 网站已成功更新！
```

#### 示例 4：删除网站

```
你: 删除 ID 为 GHI13579 的网站

Claude: [调用 delete_website 工具]

✅ 网站已删除

网站 ID: GHI13579

⚠️ 注意：此操作不可撤销，网站的所有文件已被永久删除。
```

---

## 在 Cursor 中使用

### 配置步骤

1. **找到配置文件位置**

   - **macOS / Linux**: `~/.cursor/mcp.json`
   - **Windows**: `%APPDATA%/Cursor/mcp.json`

2. **编辑配置文件**

   ```json
   {
     "demox": {
       "command": "npx",
       "args": ["-y", "@demox/mcp-server"],
       "env": {
         "DEMOX_CLIENT_ID": "demox-mcp-client",
         "DEMOX_AUTH_URL": "https://demox.site/mcp/authorize"
       }
     }
   }
   ```

3. **重启 Cursor**

### 使用示例

#### 在 Cursor Chat 中

```
# 在 Cursor 的 Chat 面板中输入

部署当前项目到 Demox，网站名称叫 "my-awesome-project"

# Cursor 会自动：
# 1. 调用 deploy_website 工具
# 2. 将项目打包
# 3. 上传并部署
# 4. 返回访问链接
```

---

## 编程方式调用

如果需要在代码中调用 Demox API，可以使用 `@demox/mcp-server` 提供的类。

### 安装

```bash
npm install @demox/mcp-server
```

### 示例代码

```typescript
import { DemoxClient, OAuthManager } from "@demox/mcp-server";

async function deployMySite() {
  // 1. 初始化 OAuth Manager
  const oauthManager = new OAuthManager();

  // 2. 获取 Access Token
  const accessToken = await oauthManager.ensureAuthenticated();

  // 3. 初始化 Demox Client
  const client = new DemoxClient(accessToken);

  // 4. 部署网站
  const result = await client.deployWebsite(
    {
      zipFile: "./my-site.zip", // 或 base64 编码的字符串
      fileName: "My Awesome Site",
    },
    accessToken
  );

  console.log("部署成功！", result);
  // { url: "https://...", websiteId: "ABC12345", path: "..." }
}

// 调用
deployMySite();
```

### 高级用法

```typescript
import { DemoxClient, OAuthManager } from "@demox/mcp-server";

async function advancedUsage() {
  const oauthManager = new OAuthManager();
  const accessToken = await oauthManager.ensureAuthenticated();
  const client = new DemoxClient(accessToken);

  // 1. 列出所有网站
  const websites = await client.listWebsites(accessToken);
  console.log("所有网站:", websites);

  // 2. 获取网站详情
  const website = await client.getWebsite("ABC12345", accessToken);
  console.log("网站详情:", website);

  // 3. 更新网站
  const updated = await client.deployWebsite(
    {
      zipFile: "./updated.zip",
      fileName: "Updated Site",
      websiteId: "ABC12345", // 更新现有网站
    },
    accessToken
  );

  // 4. 删除网站
  await client.deleteWebsite("XYZ67890", accessToken);
}
```

---

## 常见使用场景

### 场景 1：自动化部署流水线

```bash
#!/bin/bash
# deploy.sh

echo "开始部署..."

# 1. 构建项目
npm run build

# 2. 打包
cd dist
zip -r ../site.zip .
cd ..

# 3. 部署到 Demox
demox-mcp deploy ./site.zip --name "Production Build"

echo "部署完成！"
```

### 场景 2：预览 Pull Request

```bash
#!/bin/bash
# preview-pr.sh

PR_NUMBER=$1
SITE_NAME="PR-preview-${PR_NUMBER}"

# 构建
npm run build

# 打包
cd dist
zip -r ../pr-${PR_NUMBER}.zip .
cd ..

# 部署
demox-mcp deploy ./pr-${PR_NUMBER}.zip --name "$SITE_NAME"

echo "预览地址已生成"
demox-mcp list | grep "$SITE_NAME"
```

### 场景 3：多环境部署

```bash
#!/bin/bash
# deploy-all.sh

# 开发环境
export DEMOX_SERVER_ENV="dev-env"
demox-mcp deploy ./build-dev.zip --name "Dev Site"

# 预发布环境
export DEMOX_SERVER_ENV="staging-env"
demox-mcp deploy ./build-staging.zip --name "Staging Site"

# 生产环境
export DEMOX_SERVER_ENV="prod-env"
demox-mcp deploy ./build-prod.zip --name "Production Site"
```

### 场景 4：批量部署多个项目

```javascript
// deploy-projects.js
import { DemoxClient, OAuthManager } from "@demox/mcp-server";
import { readdir } from "fs/promises";

const projects = [
  { path: "./projects/project-a.zip", name: "Project A" },
  { path: "./projects/project-b.zip", name: "Project B" },
  { path: "./projects/project-c.zip", name: "Project C" },
];

async function deployAll() {
  const oauthManager = new OAuthManager();
  const accessToken = await oauthManager.ensureAuthenticated();
  const client = new DemoxClient(accessToken);

  for (const project of projects) {
    try {
      console.log(`正在部署 ${project.name}...`);
      const result = await client.deployWebsite(
        {
          zipFile: project.path,
          fileName: project.name,
        },
        accessToken
      );
      console.log(`✅ ${project.name} 部署成功: ${result.url}`);
    } catch (error) {
      console.error(`❌ ${project.name} 部署失败:`, error.message);
    }
  }
}

deployAll();
```

### 场景 5：定期清理过期网站

```javascript
// cleanup.js
import { DemoxClient, OAuthManager } from "@demox/mcp-server";

const DAYS_THRESHOLD = 30;

async function cleanupOldSites() {
  const oauthManager = new OAuthManager();
  const accessToken = await oauthManager.ensureAuthenticated();
  const client = new DemoxClient(accessToken);

  const websites = await client.listWebsites(accessToken);
  const now = Date.now();

  for (const site of websites) {
    const createdAt = new Date(site.createdAt).getTime();
    const daysOld = (now - createdAt) / (1000 * 60 * 60 * 24);

    if (daysOld > DAYS_THRESHOLD) {
      console.log(`删除过期网站: ${site.fileName} (${Math.round(daysOld)} 天前)`);
      await client.deleteWebsite(site.websiteId, accessToken);
    }
  }
}

cleanupOldSites();
```

---

## 提示和技巧

### 1. Token 自动刷新

MCP Server 会自动检测 Token 是否过期，并在需要时自动打开浏览器重新登录。

### 2. 批量操作

使用循环或并发操作来提高效率：

```javascript
// 并发部署
await Promise.all([
  client.deployWebsite({ zipFile: "./a.zip", fileName: "A" }, accessToken),
  client.deployWebsite({ zipFile: "./b.zip", fileName: "B" }, accessToken),
  client.deployWebsite({ zipFile: "./c.zip", fileName: "C" }, accessToken),
]);
```

### 3. 错误处理

始终使用 try-catch 处理错误：

```javascript
try {
  const result = await client.deployWebsite(params, accessToken);
  console.log("成功:", result);
} catch (error) {
  if (error.message.includes("TOKEN_EXPIRED")) {
    console.log("Token 已过期，正在重新登录...");
    // 重新登录
  } else if (error.message.includes("RATE_LIMIT")) {
    console.log("请求过于频繁，请稍后再试");
  }
}
```

### 4. 环境变量

使用环境变量管理配置：

```bash
export DEMOX_CLIENT_ID="your-client-id"
export DEMOX_AUTH_URL="https://demox.site/mcp/authorize"
export DEMOX_API_BASE="https://demox.site"
export DEMOX_SERVER_ENV="your-env-id"
```

---

需要更多帮助？查看 [常见问题](FAQ.md) 或 [部署指南](../DEPLOYMENT.md)。
