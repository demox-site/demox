# Demox MCP Server - 常见问题

本文档收集了用户在使用 Demox MCP Server 时遇到的常见问题及解决方案。

## 目录

- [安装和配置](#安装和配置)
- [认证和登录](#认证和登录)
- [使用问题](#使用问题)
- [错误排查](#错误排查)
- [性能优化](#性能优化)
- [安全问题](#安全问题)

---

## 安装和配置

### Q1: MCP Server 支持哪些操作系统？

**A**: 支持 macOS、Linux 和 Windows。需要 Node.js >= 18.0.0。

### Q2: 如何验证 MCP Server 是否安装成功？

**A**: 运行以下命令：

```bash
# 全局安装
npm install -g @demox/mcp-server

# 验证
demox-mcp --version
```

应该显示版本号：`1.0.0`

### Q3: 配置文件放在哪里？

**A**: 不同 AI 工具的配置文件位置不同：

**Claude Desktop**:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

**Cursor**:
- macOS/Linux: `~/.cursor/mcp.json`
- Windows: `%APPDATA%/Cursor/mcp.json`

**Cline (VS Code 插件)**:
- 所有平台: `~/.cline/mcp.json`

### Q4: 如何在多个 AI 工具中使用？

**A**: 在每个工具的配置文件中都添加 Demox MCP Server 配置：

```json
{
  "mcpServers": {
    "demox": {
      "command": "npx",
      "args": ["-y", "@demox/mcp-server"],
      "env": { ... }
    }
  }
}
```

每个工具都会独立管理登录状态。

### Q5: npx 方式和全局安装有什么区别？

**A**:

**npx 方式**（推荐）:
- 每次运行时自动使用最新版本
- 无需手动安装
- 适合大多数用户

**全局安装**:
- 需要手动更新
- 启动更快（无需下载）
- 适合频繁使用的场景

---

## 认证和登录

### Q6: 首次使用时没有弹出登录窗口？

**A**: 可能的原因：

1. **浏览器被阻止**：检查终端是否有错误信息
2. **端口被占用**：确保端口 39897 未被占用
3. **防火墙阻止**：临时关闭防火墙测试

**解决方案**：
```bash
# 手动测试登录
demox-mcp login
```

### Q7: Token 过期后需要重新登录吗？

**A**: 是的。Token 有效期为 30 天，过期后会自动弹出浏览器重新登录。

**查看 Token 状态**：
```bash
demox-mcp status
```

### Q8: 如何在多台设备上使用？

**A**: 每台设备需要单独登录：

1. 在每台设备上配置 MCP Server
2. 首次使用时会自动打开浏览器登录
3. 每台设备的 Token 独立存储

**注意**：Token 存储在本地，不会在设备间同步。

### Q9: 如何撤销已授权的设备？

**A**: 目前需要手动删除本地 Token：

```bash
# 方法 1: 使用 CLI
demox-mcp logout

# 方法 2: 手动删除
rm ~/.demox/token.json
```

未来版本将支持在 Web 界面管理设备。

### Q10: 登录后显示 "认证失败"？

**A**: 可能的原因：

1. **Token 文件损坏**：删除 Token 并重新登录
   ```bash
   rm ~/.demox/token.json
   demox-mcp login
   ```

2. **网络问题**：检查网络连接和代理设置

3. **云函数未部署**：确认 `oauth-token-manager` 云函数已部署

---

## 使用问题

### Q11: 如何部署已经打包好的项目？

**A**: 如果项目已经打包好（如 `./dist` 目录），可以：

**方法 1: 使用 CLI**
```bash
cd dist
zip -r ../site.zip .
cd ..
demox-mcp deploy ./site.zip --name "My Site"
```

**方法 2: 在 Claude Desktop 中**
```
你: 帮我部署 ./dist 目录，网站名称叫 "My Site"
Claude: [会自动打包并部署]
```

### Q12: 支持部署哪些类型的网站？

**A**: 支持所有静态网站，包括：

- ✅ 纯 HTML/CSS/JS
- ✅ React 打包产物
- ✅ Vue 打包产物
- ✅ Angular 打包产物
- ✅ Next.js 静态导出
- ✅ Vite 打包产物
- ✅ 其他静态网站生成器

不支持：
- ❌ 需要后端服务的应用（如 SSR）
- ❌ 需要数据库的应用

### Q13: 部署失败怎么办？

**A**: 按以下步骤排查：

1. **检查文件大小**：单个文件限制 100MB
2. **检查文件格式**：必须是有效的 ZIP 文件
3. **查看错误信息**：
   ```bash
   demox-mcp test
   ```

4. **检查云函数日志**：
   ```bash
   cloudbase functions:log deploy-website
   ```

### Q14: 如何更新已部署的网站？

**A**: 使用相同的 `websiteId` 重新部署：

```bash
demox-mcp deploy ./new.zip --name "My Site" --id ABC12345
```

或在 Claude Desktop 中：
```
你: 更新我的网站 ABC12345，新文件在 ./new.zip
```

### Q15: 可以部署多个网站吗？

**A**: 可以！根据您的角色权限：

- **user 角色**: 通常限制 5-10 个网站
- **admin 角色**: 可能无限或更高限额

**查看当前网站数量**：
```bash
demox-mcp list
```

---

## 错误排查

### Q16: 错误 "TOKEN_INVALID" 或 "TOKEN_EXPIRED"

**A**: Token 无效或已过期。

**解决方案**：
```bash
# 删除旧 Token
rm ~/.demox/token.json

# 重新登录
demox-mcp login
```

### Q17: 错误 "CLOUDFUNCTION_FAILED"

**A**: 云函数调用失败。

**排查步骤**：

1. **检查云函数是否部署**：
   ```bash
   cloudbase functions:list
   ```

2. **查看云函数日志**：
   ```bash
   cloudbase functions:log oauth-token-manager
   cloudbase functions:log deploy-website
   ```

3. **检查环境 ID**：
   确认配置中的 `DEMOX_SERVER_ENV` 正确

### Q18: 错误 "NETWORK_ERROR"

**A**: 网络连接问题。

**排查步骤**：

1. **检查网络连接**：
   ```bash
   ping demox.site
   ```

2. **检查代理设置**（如果使用代理）：
   ```bash
   export HTTP_PROXY=http://your-proxy:port
   export HTTPS_PROXY=http://your-proxy:port
   ```

3. **检查防火墙**：临时关闭防火墙测试

### Q19: 错误 "RATE_LIMIT_EXCEEDED"

**A**: 请求过于频繁，超过了速率限制。

**解决方案**：

1. **等待几分钟后重试**
2. **联系管理员**提高限额
3. **检查是否有异常的循环调用**

### Q20: 部署后无法访问网站

**A**: 可能的原因：

1. **CDN 缓存**：等待 1-2 分钟让 CDN 生效
2. **域名配置**：确认域名 `demox.site` 已正确配置
3. **文件路径**：确认 ZIP 包中包含正确的文件结构
4. **index.html**：确保根目录有 `index.html` 文件

**检查部署结果**：
```bash
demox-mcp list
# 找到网站的 URL 并在浏览器中访问
```

---

## 性能优化

### Q21: 如何加快部署速度？

**A**: 优化建议：

1. **压缩 ZIP 文件**：使用更高压缩级别
   ```bash
   zip -9 -r site.zip dist/
   ```

2. **排除不必要的文件**：
   ```bash
   zip -r site.zip dist/ -x "*.map" "node_modules/*"
   ```

3. **使用并发部署**（如果有多个网站）：
   ```javascript
   await Promise.all([
     deploy(siteA),
     deploy(siteB),
     deploy(siteC),
   ]);
   ```

### Q22: 大文件部署很慢怎么办？

**A**:

1. **检查上传速度**：使用测速工具
2. **分批部署**：将大文件拆分成多个小文件
3. **优化文件大小**：压缩图片、删除未使用的代码

### Q23: 如何减少 CDN 流量费用？

**A**:

1. **启用缓存**：在文件名中添加 hash
2. **压缩资源**：使用 gzip/brotli
3. **延迟加载**：实现懒加载
4. **使用 CDN 缓存规则**：配置合理的缓存策略

---

## 安全问题

### Q24: Token 存储在哪里？安全吗？

**A**:

- **存储位置**：`~/.demox/token.json`（本地）
- **安全性**：
  - ✅ 文件权限设置为仅当前用户可读写
  - ✅ 不会上传到其他服务器
  - ✅ 使用 HTTPS 传输
  - ⚠️ 建议定期更换 Token

### Q25: 如何在 CI/CD 中使用？

**A**: 推荐使用环境变量：

```bash
export DEMOX_CLIENT_ID="your-client-id"
export DEMOX_AUTH_URL="https://..."
export DEMOX_API_BASE="https://..."

# 使用 Service Account（如果提供）
export DEMOX_SERVICE_TOKEN="your-service-token"
```

**最佳实践**：
- 使用 CI/CD 的 Secret 管理功能
- 定期轮换 Token
- 限制 Token 权限范围

### Q26: Token 泄露了怎么办？

**A**: 立即执行以下操作：

1. **删除本地 Token**：
   ```bash
   rm ~/.demox/token.json
   ```

2. **重新登录**：获取新 Token

3. **检查异常活动**：查看云函数日志

4. **联系支持**：报告安全问题

### Q27: 可以在企业内网中使用吗？

**A**: 可以，但需要：

1. **配置代理**（如果需要）：
   ```bash
   export HTTP_PROXY=http://proxy.company.com:port
   export HTTPS_PROXY=http://proxy.company.com:port
   ```

2. **添加白名单**：将以下域名添加到白名单：
   - `demox.site`
   - `*.tencentcloudapi.com`

---

## 其他问题

### Q28: 如何获取技术支持？

**A**:

- 📧 邮箱：support@demox.site
- 🐛 Issues：https://github.com/demox/mcp-server/issues
- 📖 文档：https://docs.demox.site

### Q29: 如何贡献代码？

**A**: 欢迎贡献！

1. Fork 项目
2. 创建功能分支
3. 提交 Pull Request

详见 [贡献指南](CONTRIBUTING.md)

### Q30: 什么时候会有新功能？

**A**: 关注我们的更新日志：

- GitHub Releases：https://github.com/demox/mcp-server/releases
- 更新公告：https://demox.site/blog

**计划中的功能**：
- [ ] Web 设备管理界面
- [ ] 多环境支持
- [ ] 自定义域名
- [ ] 网站访问统计
- [ ] 更多部署选项

---

还有其他问题？

请查看 [完整文档](README.md) 或 [使用示例](EXAMPLES.md)。
