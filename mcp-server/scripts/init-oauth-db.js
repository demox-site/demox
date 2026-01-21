/**
 * OAuth 数据库初始化脚本
 *
 * 用途：创建 OAuth 认证所需的数据库集合和初始数据
 *
 * 使用方法：
 * 1. 安装依赖：npm install @cloudbase/node-sdk
 * 2. 修改环境变量 TCB_ENV 为你的环境 ID
 * 3. 运行：node scripts/init-oauth-db.js
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tcb = require("@cloudbase/node-sdk");

// 配置
const ENV_ID = process.env.TCB_ENV || "moyu-3g5pbxld00f4aead";

// 初始化
const app = tcb.init({
  env: ENV_ID,
});

const db = app.database();

/**
 * 初始化 OAuth 客户端
 */
async function initOAuthClient() {
  console.log("正在创建 OAuth 客户端...");

  try {
    // 检查是否已存在
    const existing = await db.collection("oauth_clients").doc("demox-mcp-client").get();

    if (existing.data && existing.data.length > 0) {
      console.log("✓ OAuth 客户端已存在，跳过创建");
      return;
    }

    // 创建 OAuth 客户端
    await db.collection("oauth_clients").add({
      _id: "demox-mcp-client",
      name: "Demox MCP Server",
      type: "public",
      redirectUris: ["http://localhost:39897/callback", "http://localhost:*/callback"],
      allowedScopes: ["website:deploy", "website:list", "website:delete", "website:update"],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("✓ OAuth 客户端创建成功");
  } catch (error) {
    if (error.code === "DATABASE_COLLECTION_NOT_EXIST") {
      console.log("! 集合不存在，将自动创建");
    } else {
      console.error("✗ 创建 OAuth 客户端失败:", error.message);
      throw error;
    }
  }
}

/**
 * 初始化索引
 */
async function initIndexes() {
  console.log("\n正在创建索引...");

  try {
    // oauth_auth_codes 索引
    try {
      await db.collection("oauth_auth_codes").createIndex({
        code: 1,
        expiresAt: 1,
      });
      console.log("✓ oauth_auth_codes 索引创建成功");
    } catch (e) {
      console.log("  oauth_auth_codes 索引已存在或创建失败");
    }

    // oauth_refresh_tokens 索引
    try {
      await db.collection("oauth_refresh_tokens").createIndex({
        token: 1,
        userId: 1,
        expiresAt: 1,
      });
      console.log("✓ oauth_refresh_tokens 索引创建成功");
    } catch (e) {
      console.log("  oauth_refresh_tokens 索引已存在或创建失败");
    }

    // mcp_sessions 索引
    try {
      await db.collection("mcp_sessions").createIndex({
        userId: 1,
        isActive: 1,
      });
      console.log("✓ mcp_sessions 索引创建成功");
    } catch (e) {
      console.log("  mcp_sessions 索引已存在或创建失败");
    }

    // oauth_audit_log 索引
    try {
      await db.collection("oauth_audit_log").createIndex({
        userId: 1,
        timestamp: -1,
      });
      console.log("✓ oauth_audit_log 索引创建成功");
    } catch (e) {
      console.log("  oauth_audit_log 索引已存在或创建失败");
    }
  } catch (error) {
    console.error("✗ 创建索引失败:", error.message);
  }
}

/**
 * 测试连接
 */
async function testConnection() {
  console.log("\n正在测试数据库连接...");

  try {
    // 尝试查询一个集合
    await db.collection("oauth_clients").limit(1).get();
    console.log("✓ 数据库连接成功");
    return true;
  } catch (error) {
    console.error("✗ 数据库连接失败:", error.message);
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log("=".repeat(60));
  console.log("OAuth 数据库初始化脚本");
  console.log(`环境 ID: ${ENV_ID}`);
  console.log("=".repeat(60));
  console.log();

  try {
    // 1. 测试连接
    const connected = await testConnection();
    if (!connected) {
      console.error("\n数据库连接失败，请检查环境 ID 和网络连接");
      process.exit(1);
    }

    // 2. 初始化 OAuth 客户端
    await initOAuthClient();

    // 3. 创建索引
    await initIndexes();

    console.log("\n" + "=".repeat(60));
    console.log("✓ 初始化完成！");
    console.log("=".repeat(60));

    console.log("\n下一步：");
    console.log("1. 部署云函数：cloudbase functions:deploy oauth-token-manager");
    console.log("2. 更新现有云函数：cloudbase functions:deploy deploy-website");
    console.log("3. 构建并部署前端");
    console.log("4. 访问 https://demox.site/#/mcp-setup 查看配置页面");
  } catch (error) {
    console.error("\n初始化失败:", error);
    process.exit(1);
  }
}

// 运行
main();
