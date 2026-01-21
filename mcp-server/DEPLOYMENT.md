# MCP API 部署指南

## 本地开发环境

本地开发环境使用本地 API 服务器，无需配置云函数 HTTP 触发器。

### 启动本地 API 服务器

```bash
cd /Users/phosa/data/project/moyu/ai-builder/mcp-server
node local-api-server.cjs
```

服务器会在 `http://localhost:8082` 启动，提供以下端点：

- `POST /api/mcp/exchange_token` - Token 交换
- `GET  /api/health` - 健康检查

## 生产环境部署

生产环境有两种方案：

### 方案 1：使用云函数 HTTP 触发器（推荐）

#### 步骤 1：部署云函数

云函数 `api-mcp` 已经部署，位于：
```
/cloudfunctions/api-mcp/index.js
```

#### 步骤 2：配置 HTTP 触发器

由于 API 网关已停止售卖，需要使用云函数访问服务：

1. 登录腾讯云云开发控制台
2. 进入环境：moyu-3g5pbxld00f4aead
3. 选择「云函数」->「api-mcp」
4. 点击「函数配置」->「触发器配置」
5. 添加「API 网关触发器」（如果可用）或使用「云函数访问服务」

#### 步骤 3：获取访问地址

配置完成后，会获得一个 HTTP 访问地址，格式类似：
```
https://<gateway-id>.tcloudbase.com/api/mcp/exchange_token
```

#### 步骤 4：更新 MCP 配置

在 MCP Server 的 `config.ts` 中，将 `apiBase` 配置为生产地址：

```typescript
apiBase: process.env.DEMOX_API_BASE || "https://demox.site"
```

确保生产环境的 `https://demox.site/api/mcp/exchange_token` 可以访问到云函数。

### 方案 2：使用前端代理（临时方案）

如果无法配置 HTTP 触发器，可以创建一个前端页面来代理请求：

1. 在前端项目中添加 API 路由
2. 使用 CloudBase JS SDK 调用云函数
3. 返回 JSON 响应

这个方案的实现可以参考：
```
/src/api/mcp.tsx
```

## 当前配置

MCP Server 当前配置（`src/utils/config.ts`）：

```typescript
export function loadConfig(): MCPConfig {
  return {
    clientId: "demox-mcp-client",
    authUrl: process.env.DEMOX_AUTH_URL || "http://localhost:8080/#/mcp-authorize",
    apiBase: process.env.DEMOX_API_BASE || "https://demox.site",
    serverEnv: process.env.DEMOX_SERVER_ENV || "moyu-3g5pbxld00f4aead",
  };
}
```

### 环境变量

- `DEMOX_AUTH_URL` - OAuth 授权页面 URL
- `DEMOX_API_BASE` - API 基础 URL（决定使用哪个 Token 交换 API）
- `DEMOX_SERVER_ENV` - CloudBase 环境 ID

### 使用示例

**本地开发（使用本地 API 服务器）：**
```bash
# 自动使用 localhost:8082
demox-mcp login
```

**生产环境（使用云函数 API）：**
```bash
# 设置生产 API 地址
export DEMOX_API_BASE=https://demox.site
demox-mcp login
```

## 验证部署

### 测试本地 API 服务器

```bash
curl http://localhost:8082/api/health
```

应该返回：
```json
{
  "status": "ok",
  "service": "Demox MCP Local API Server (Test Mode)"
}
```

### 测试云函数

通过 CloudBase 控制台测试云函数，或使用前端 SDK 调用。

## 故障排除

### 问题：无法连接到本地 API 服务器

**解决方案**：
1. 确保本地 API 服务器正在运行
2. 检查端口 8082 是否被占用
3. 查看服务器日志：`cat /tmp/api-server.log`

### 问题：生产 API 返回 404

**解决方案**：
1. 确认云函数已部署
2. 配置 HTTP 触发器
3. 检查域名配置和 CORS 设置

### 问题：Token 交换失败

**解决方案**：
1. 检查云函数日志
2. 验证 oauth-token-manager 云函数是否正常工作
3. 确认授权码有效且未过期
