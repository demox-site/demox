# Demox MCP 服务 - 部署指南

本文档介绍如何部署 Demox MCP 服务的完整流程。

## 📋 部署检查清单

- [ ] Node.js >= 18.0.0
- [ ] CloudBase CLI 已安装
- [ ] CloudBase 环境已创建
- [ ] 项目代码已准备

## 🚀 部署步骤

### 1. 安装依赖

```bash
# 在项目根目录
npm install

# 在 MCP Server 目录
cd mcp-server
npm install
cd ..
```

### 2. 初始化数据库

```bash
# 运行数据库初始化脚本
node scripts/init-oauth-db.js
```

这将创建：
- `oauth_clients` 集合
- `oauth_auth_codes` 集合
- `oauth_refresh_tokens` 集合
- `mcp_sessions` 集合
- `oauth_audit_log` 集合

以及必要的索引。

### 3. 部署云函数

```bash
# 部署 OAuth Token 管理云函数
cloudbase functions:deploy oauth-token-manager

# 更新现有云函数（已支持 Token 认证）
cloudbase functions:deploy deploy-website
```

### 4. 构建 MCP Server

```bash
cd mcp-server
npm run build
cd ..
```

构建产物在 `mcp-server/dist/` 目录。

### 5. 测试 MCP Server

```bash
cd mcp-server

# 方式 1：直接运行测试
npm run dev

# 方式 2：使用 MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

### 6. 构建和部署前端

```bash
# 在项目根目录
npm run build

# 部署到静态托管
cloudbase hosting deploy dist
```

### 7. 验证部署

1. 访问 `https://demox.site/#/mcp-setup`
2. 下载配置文件
3. 导入到 Claude Desktop 或 Cursor
4. 测试 MCP 工具调用

## 🔧 本地开发

### 前端开发

```bash
npm run dev
```

### MCP Server 开发

```bash
cd mcp-server
npm run dev
```

### 云函数本地调试

```bash
# 安装云函数本地调试工具
npm install -g @cloudbase/cli

# 本地运行云函数
cloudbase functions:run oauth-token-manager
cloudbase functions:run deploy-website
```

## 📊 监控和维护

### 查看云函数日志

```bash
cloudbase functions:log oauth-token-manager
cloudbase functions:log deploy-website
```

### 查看数据库

在 CloudBase 控制台中查看：
- `oauth_clients` - OAuth 客户端配置
- `oauth_auth_codes` - 授权码（自动清理）
- `oauth_refresh_tokens` - 刷新令牌
- `mcp_sessions` - MCP 会话记录
- `oauth_audit_log` - 操作审计日志

### 清理过期数据

```javascript
// 在 CloudBase 控制台运行
// 清理过期的授权码
db.collection('oauth_auth_codes').where({
  expiresAt: db.command.lt(new Date())
}).remove();

// 清理过期的刷新令牌
db.collection('oauth_refresh_tokens').where({
  expiresAt: db.command.lt(new Date())
}).remove();
```

## 🔐 安全建议

1. **定期轮换密钥**
   - 定期更新 CloudBase 自定义登录密钥
   - 定期更新 COS 密钥

2. **监控异常行为**
   - 单用户短时间内多次刷新 Token
   - 单个设备异常频繁的 API 调用
   - 授权失败率突增

3. **限流保护**
   - 在云函数中实现速率限制
   - 使用 CloudBase 的安全规则

4. **数据备份**
   - 定期备份重要数据库集合
   - 备份 OAuth 客户端配置

## 🐛 故障排除

### 问题 1：云函数调用失败

**症状**：MCP Server 提示云函数调用失败

**解决方案**：
1. 检查云函数是否部署成功
2. 检查云函数日志
3. 验证环境 ID 是否正确

### 问题 2：Token 验证失败

**症状**：提示 "访问令牌无效或已过期"

**解决方案**：
1. 检查系统时间是否正确
2. 删除本地 Token 文件：`rm ~/.demox/token.json`
3. 重新登录

### 问题 3：数据库集合不存在

**症状**：云函数日志显示 "DATABASE_COLLECTION_NOT_EXIST"

**解决方案**：
1. 重新运行数据库初始化脚本
2. 或在 CloudBase 控制台手动创建集合

### 问题 4：CORS 错误

**症状**：浏览器提示跨域错误

**解决方案**：
1. 在 CloudBase 静态托管配置中添加 CORS 规则
2. 或使用云函数作为代理

## 📈 性能优化

1. **云函数优化**
   - 使用云函数并发
   - 优化数据库查询
   - 使用缓存

2. **前端优化**
   - 启用 CDN 加速
   - 压缩静态资源
   - 使用懒加载

3. **MCP Server 优化**
   - 减少不必要的日志输出
   - 优化 Token 刷新逻辑
   - 使用连接池

## 🔄 更新升级

### 更新 MCP Server

```bash
cd mcp-server
git pull
npm install
npm run build
```

### 更新云函数

```bash
cloudbase functions:deploy oauth-token-manager
cloudbase functions:deploy deploy-website
```

### 更新前端

```bash
npm run build
cloudbase hosting deploy dist
```

## 📞 获取帮助

- 文档：https://docs.demox.site
- Issues：https://github.com/demox/mcp-server/issues
- 邮箱：support@demox.site

---

祝部署顺利！🎉
