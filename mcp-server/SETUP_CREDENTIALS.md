# 配置腾讯云凭证指南

## 为什么需要凭证？

MCP Server 需要调用 CloudBase 云函数来交换 Token。CloudBase Node SDK 调用云函数需要腾讯云访问凭证。

## 🔐 获取凭证步骤

### 方法 1：通过 CloudBase 控制台（推荐）

1. **登录 CloudBase 控制台**
   - 访问：https://console.cloud.tencent.com/tcb
   - 选择环境：`moyu-3g5pbxld00f4aead`

2. **获取环境信息**
   - 点击「环境设置」
   - 查看「环境ID」：`moyu-3g5pbxld00f4aead`

3. **创建或使用现有密钥**
   - 点击左侧菜单「云函数」
   - 点击任意一个云函数
   - 点击「函数配置」
   - 查看或创建「访问密钥」

### 方法 2：通过腾讯云访问管理控制台

1. **访问密钥管理**
   - 访问：https://console.cloud.tencent.com/cam/capi

2. **创建密钥**
   - 点击「新建密钥」
   - 记录 `SecretId` 和 `SecretKey`

## ⚙️ 配置凭证

### macOS / Linux

**临时配置（当前终端会话）：**
```bash
export TCB_SECRET_ID=你的SecretId
export TCB_SECRET_KEY=你的SecretKey
```

**永久配置（添加到 ~/.zshrc）：**
```bash
echo 'export TCB_SECRET_ID=你的SecretId' >> ~/.zshrc
echo 'export TCB_SECRET_KEY=你的SecretKey' >> ~/.zshrc
source ~/.zshrc
```

### Windows

**PowerShell：**
```powershell
$env:TCB_SECRET_ID="你的SecretId"
$env:TCB_SECRET_KEY="你的SecretKey"
```

**CMD：**
```cmd
set TCB_SECRET_ID=你的SecretId
set TCB_SECRET_KEY=你的SecretKey
```

## 🧪 验证配置

```bash
# 查看环境变量
echo $TCB_SECRET_ID
echo $TCB_SECRET_KEY

# 测试登录
demox-mcp login
```

## 🔒 安全说明

- ✅ 凭证只会保存在本地环境变量中
- ✅ 不会被提交到 Git
- ✅ 可以随时撤销或重新生成
- ✅ 建议定期轮换密钥

## ❓ 常见问题

### Q: 为什么要配置凭证？
A: CloudBase Node SDK 调用云函数需要腾讯云访问凭证进行身份验证。

### Q: 安全吗？
A: 是的。凭证只保存在你的本地电脑，不会被上传。建议定期轮换密钥。

### Q: 可以不用凭证吗？
A: 如果不想配置凭证，有以下替代方案：
1. 使用本地 API 服务器（需要额外运行一个 Node.js 服务）
2. 配置云函数 HTTP 触发器（但 API 网关已停止售卖）
3. 等待 CloudBase 提供新的无凭证访问方式

目前配置凭证是最简单、最可靠的方案。

## 📝 下一步

配置凭证后，就可以正常使用 MCP 了：

```bash
# 登录
demox-mcp login

# 部署网站
demox-mcp deploy ./dist --name "My Site"

# 查看网站列表
demox-mcp list
```
