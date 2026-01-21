# 部署 mcp-api 云函数

mcp-api 云函数作为 HTTP 代理，允许 MCP Server 在不配置腾讯云凭证的情况下调用其他云函数。

## 部署步骤

### 方法 1：通过 CloudBase 控制台部署

1. **登录 CloudBase 控制台**
   - 访问：https://console.cloud.tencent.com/tcb
   - 选择环境：`moyu-3g5pbxld00f4aead`

2. **创建云函数**
   - 点击左侧菜单「云函数」
   - 点击「新建」
   - 函数名称：`mcp-api`
   - 运行环境：Node.js 16.13
   - 点击「下一步」

3. **上传函数代码**
   - 选择「本地上传」
   - 上传文件夹：`/Users/phosa/data/project/moyu/ai-builder/cloudfunctions/mcp-api`
   - 或直接在线编辑，将 `index.js` 的内容复制粘贴进去

4. **配置 HTTP 触发器**
   - 函数创建后，点击「函数配置」->「触发器配置」
   - 点击「添加触发器」
   - 选择「云函数 HTTP 访问服务」或「API 网关触发器」
   - 路径：`/mcp-api`
   - 请求方法：POST
   - 点击「保存」

5. **获取访问地址**
   - 配置完成后，会显示 HTTP 访问地址
   - 格式类似：`https://moyu-3g5pbxld00f4aead.ap-chengdu.tcb.qcloud.la/mcp-api`

### 方法 2：使用 CloudBase CLI 部署（需要先安装 CLI）

```bash
# 安装 CloudBase CLI
npm install -g @cloudbase/cloudbase-cli

# 登录
cloudbase login

# 部署云函数
cd /Users/phosa/data/project/moyu/ai-builder
cloudbase functions:deploy mcp-api
```

## 测试部署

部署完成后，可以测试云函数是否正常工作：

```bash
curl -X POST 'https://moyu-3g5pbxld00f4aead.ap-chengdu.tcb.qcloud.la/mcp-api' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -d '{
    "functionName": "deploy-website",
    "data": {
      "action": "list"
    }
  }'
```

## 云函数说明

`mcp-api` 云函数的作用：

1. **HTTP 代理**：接收 MCP Server 的 HTTP 请求
2. **认证验证**：验证 CloudBase access token
3. **调用云函数**：在云函数环境中调用其他云函数（无需客户端配置凭证）
4. **返回结果**：将结果返回给 MCP Server

优势：

- ✅ 客户端无需配置腾讯云凭证
- ✅ 使用 CloudBase access token 认证
- ✅ 所有云函数调用都通过统一的 HTTP API

## 注意事项

1. 确保 `mcp-api` 云函数与 `deploy-website` 等云函数在同一个环境中
2. HTTP 访问需要配置正确的触发器路径
3. Token 验证失败会返回 401 错误
