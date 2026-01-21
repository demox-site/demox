# 手动部署 mcp-api 云函数指南

由于 CloudBase CLI 不可用，请通过以下方式手动部署：

## 方法 1：通过 CloudBase 控制台在线编辑（最简单）

### 步骤：

1. **登录 CloudBase 控制台**
   - 访问：https://console.cloud.tencent.com/tcb/tcb?envId=moyu-3g5pbxld00f4aead

2. **进入云函数管理**
   - 点击左侧菜单「云函数」
   - 点击「新建」按钮

3. **创建云函数**
   - 函数名称：`mcp-api`
   - 运行环境：`Node.js 16.13`
   - 函数描述：`MCP API 代理 - 允许 MCP Server 调用其他云函数`
   - 点击「下一步」

4. **编辑函数代码**
   - 在在线编辑器中，清空默认代码
   - 复制以下完整代码到编辑器：

```javascript
const tcb = require('@cloudbase/node-sdk');

/**
 * MCP API 云函数
 * 作为 HTTP 代理，允许 MCP Server 调用其他云函数
 */

exports.main = async (event, context) => {
  try {
    // 解析请求体
    let requestData;
    try {
      requestData = event.body ? JSON.parse(event.body) : {};
    } catch (error) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: '请求体 JSON 格式错误'
          }
        }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // 从 Authorization 头获取 access_token
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    const accessToken = authHeader?.replace('Bearer ', '') || requestData.accessToken;

    if (!accessToken) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: '缺少认证令牌'
          }
        }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    const { functionName } = requestData;

    if (!functionName) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'MISSING_FUNCTION_NAME',
            message: '缺少 functionName 参数'
          }
        }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // 验证 access token
    const app = tcb.init({
      env: context.namespace || process.env.TCB_ENV
    });

    const auth = app.auth();
    let userInfo;
    try {
      const result = await auth.getEndUserInfo(accessToken);
      userInfo = result.userInfo || result;
    } catch (error) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: {
            code: 'TOKEN_INVALID',
            message: '访问令牌无效或已过期'
          }
        }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    const userId = userInfo?.uid || userInfo?.openId;
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: {
            code: 'TOKEN_INVALID',
            message: '无法从 Token 中获取用户身份'
          }
        }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    console.log(`[MCP API] 用户 ${userId} 调用云函数: ${functionName}`);

    // 调用目标云函数
    const result = await app.callFunction({
      name: functionName,
      data: {
        ...requestData.data,
        accessToken,
        __userId: userId,
      },
    });

    const responseData = result?.result;

    if (responseData?.error) {
      return {
        statusCode: 400,
        body: JSON.stringify(responseData),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(responseData || {}),
      headers: { 'Content-Type': 'application/json' }
    };

  } catch (error) {
    console.error('[MCP API] 调用失败:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message || '内部服务器错误'
        }
      }),
      headers: { 'Content-Type': 'application/json' }
    };
  }
};
```

5. **保存并部署**
   - 点击「保存并部署」
   - 等待部署完成

6. **配置触发器**
   - 部署成功后，点击「触发器配置」
   - 点击「添加触发器」
   - 选择「云函数 HTTP 访问服务」
   - 路径：`/mcp-api`
   - 请求方法：`POST`
   - 点击「保存」

7. **记录访问地址**
   - 在「函数管理」标签页，可以看到 HTTP 访问地址
   - 格式类似：`https://moyu-3g5pbxld00f4aead.ap-chengdu.tcb.qcloud.la/mcp-api`

## 方法 2：使用本地上传（如果在线编辑不方便）

1. **准备 zip 文件**
   ```bash
   cd /Users/phosa/data/project/moyu/ai-builder/cloudfunctions/mcp-api
   zip -r mcp-api.zip index.js
   ```

2. **在控制台上传**
   - 在新建云函数时，选择「本地上传」
   - 上传 `mcp-api.zip` 文件
   - 其余步骤同方法 1

## 验证部署

部署完成后，运行以下命令测试：

```bash
demox-mcp list
```

如果成功，应该能看到您的网站列表。

## 故障排除

### 问题：命令仍然报错 "fetch failed"

**解决方案**：
1. 检查云函数是否部署成功
2. 检查 HTTP 触发器是否配置
3. 查看云函数日志确认是否有错误

### 问题：返回 401 Unauthorized

**解决方案**：
1. 检查 token 是否有效：`cat /Users/phosa/.demox/token.json`
2. 重新登录：`rm /Users/phosa/.demox/token.json && demox-mcp login`
