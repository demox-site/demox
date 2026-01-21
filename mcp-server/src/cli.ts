#!/usr/bin/env node

/**
 * Demox MCP CLI 工具
 *
 * 用于测试和管理 MCP 服务
 */

import { Command } from "commander";
import { OAuthManager } from "./auth/OAuthManager.js";
import { DemoxClient } from "./api/DemoxClient.js";
import { existsSync } from "fs";
import { promises as fs } from "fs";
import { dirname } from "path";
import { getTokenPath, logger } from "./utils/config.js";

const program = new Command();

program
  .name("demox-mcp")
  .description("Demox MCP Server CLI 工具")
  .version("1.0.0");

/**
 * 登录命令
 */
program
  .command("login")
  .description("登录到 Demox MCP 服务")
  .action(async () => {
    logger.info("正在启动登录流程...");

    const oauthManager = new OAuthManager();

    try {
      const accessToken = await oauthManager.authorize();
      logger.info("✅ 登录成功！");
      logger.info(`Token 已保存到: ${getTokenPath()}`);
      // 显式退出进程
      process.exit(0);
    } catch (error: any) {
      logger.error("❌ 登录失败:", error.message);
      process.exit(1);
    }
  });

/**
 * 登出命令
 */
program
  .command("logout")
  .description("登出并删除本地 Token")
  .action(async () => {
    const tokenPath = getTokenPath();

    if (!existsSync(tokenPath)) {
      logger.info("未找到本地 Token");
      return;
    }

    try {
      await fs.unlink(tokenPath);
      logger.info("✅ 已登出");
      logger.info(`Token 已删除: ${tokenPath}`);
    } catch (error: any) {
      logger.error("❌ 登出失败:", error.message);
      process.exit(1);
    }
  });

/**
 * 状态命令
 */
program
  .command("status")
  .description("查看当前登录状态")
  .action(async () => {
    const tokenPath = getTokenPath();

    if (!existsSync(tokenPath)) {
      logger.info("未登录");
      logger.info("请运行: demox-mcp login");
      return;
    }

    try {
      const content = await fs.readFile(tokenPath, "utf-8");
      const tokenData = JSON.parse(content);

      const now = Date.now();
      const expiresAt = tokenData.expiresAt;
      const daysLeft = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24));

      logger.info("✅ 已登录");
      logger.info(`用户 ID: ${tokenData.userId}`);
      logger.info(`客户端 ID: ${tokenData.clientId}`);
      logger.info(`权限范围: ${tokenData.scopes.join(", ")}`);

      if (daysLeft > 0) {
        logger.info(`Token 有效期: ${daysLeft} 天`);
      } else if (daysLeft === 0) {
        logger.warn("⚠️  Token 将在今天过期");
      } else {
        logger.warn("⚠️  Token 已过期，请重新登录");
      }

      logger.info(`保存位置: ${tokenPath}`);
    } catch (error: any) {
      logger.error("❌ 读取状态失败:", error.message);
      process.exit(1);
    }
  });

/**
 * 列出网站命令
 */
program
  .command("list")
  .description("列出所有网站")
  .action(async () => {
    const oauthManager = new OAuthManager();

    try {
      const accessToken = await oauthManager.ensureAuthenticated();
      const client = new DemoxClient(accessToken);

      const websites = await client.listWebsites(accessToken);

      if (websites.length === 0) {
        logger.info("您还没有部署任何网站");
        return;
      }

      console.log("\n📋 您的网站列表：\n");
      websites.forEach((site, index) => {
        const createdDate = new Date(site.createdAt).toLocaleString("zh-CN");
        console.log(`${index + 1}. ${site.fileName}`);
        console.log(`   ID: ${site.websiteId}`);
        console.log(`   URL: ${site.url}`);
        console.log(`   创建时间: ${createdDate}\n`);
      });
    } catch (error: any) {
      logger.error("❌ 获取网站列表失败:", error.message);
      process.exit(1);
    }
  });

/**
 * 部署网站命令
 */
program
  .command("deploy <path>")
  .description("部署网站或目录")
  .option("-n, --name <name>", "网站名称")
  .option("-i, --id <id>", "网站 ID（更新现有网站）")
  .action(async (path: string, options) => {
    const oauthManager = new OAuthManager();

    try {
      const accessToken = await oauthManager.ensureAuthenticated();
      const client = new DemoxClient(accessToken);

      // 检查路径类型
      const stat = await fs.stat(path);
      const isDirectory = stat.isDirectory();
      const isZipFile = stat.isFile() && path.endsWith(".zip");

      let fileName = options.name;

      if (!fileName) {
        if (isDirectory) {
          // 目录：使用目录名
          fileName = path.split("/").pop() || "unnamed";
          logger.info(`部署目录: ${path} → ${fileName}`);
        } else if (isZipFile) {
          // ZIP 文件：使用文件名（去掉 .zip 后缀）
          fileName = path.split("/").pop()?.replace(".zip", "") || "unnamed";
          logger.info(`部署文件: ${path} → ${fileName}`);
        } else {
          fileName = "unnamed";
        }
      }

      logger.info(`正在部署网站: ${fileName}`);

      // 直接传入路径，让 DemoxClient 自动处理
      const result = await client.deployWebsite(
        {
          zipFile: path, // 可以是文件、目录或 base64
          websiteId: options.id,
          fileName,
        },
        accessToken
      );

      logger.info("✅ 部署成功！");
      console.log(`\n网站名称: ${fileName}`);
      console.log(`网站 ID: ${result.websiteId}`);
      console.log(`访问地址: ${result.url}\n`);
    } catch (error: any) {
      logger.error("❌ 部署失败:", error.message);
      process.exit(1);
    }
  });

/**
 * 删除网站命令
 */
program
  .command("delete <websiteId>")
  .description("删除网站")
  .action(async (websiteId: string) => {
    const oauthManager = new OAuthManager();

    try {
      const accessToken = await oauthManager.ensureAuthenticated();
      const client = new DemoxClient(accessToken);

      logger.info(`正在删除网站: ${websiteId}`);
      await client.deleteWebsite(websiteId, accessToken);

      logger.info("✅ 网站已删除");
    } catch (error: any) {
      logger.error("❌ 删除失败:", error.message);
      process.exit(1);
    }
  });

/**
 * 测试命令
 */
program
  .command("test")
  .description("测试 MCP 服务连接")
  .action(async () => {
    logger.info("正在测试 MCP 服务连接...\n");

    const oauthManager = new OAuthManager();

    try {
      // 1. 测试认证
      logger.info("1. 测试认证...");
      const accessToken = await oauthManager.ensureAuthenticated();
      logger.info("   ✅ 认证成功");

      // 2. 测试 API
      logger.info("2. 测试 API 连接...");
      const client = new DemoxClient(accessToken);
      const websites = await client.listWebsites(accessToken);
      logger.info(`   ✅ API 连接成功（找到 ${websites.length} 个网站）`);

      // 3. 总结
      console.log("\n✅ 所有测试通过！MCP 服务运行正常。\n");
    } catch (error: any) {
      logger.error("\n❌ 测试失败:", error.message);
      console.log("\n故障排查：");
      console.log("1. 检查网络连接");
      console.log("2. 确认云函数已部署");
      console.log("3. 验证 Token 是否有效");
      console.log("   运行: demox-mcp status\n");
      process.exit(1);
    }
  });

/**
 * 配置命令
 */
program
  .command("config")
  .description("生成 MCP 配置文件")
  .option("-o, --output <file>", "输出文件路径", "demox-mcp.json")
  .action(async (options) => {
    // 配置已硬编码，无需环境变量
    const config = {
      mcpServers: {
        demox: {
          command: "npx",
          args: ["-y", "@demox/mcp-server"]
          // 配置已硬编码在代码中，无需 env 参数
        },
      },
    };

    try {
      await fs.writeFile(
        options.output,
        JSON.stringify(config, null, 2),
        "utf-8"
      );
      logger.info(`✅ 配置文件已生成: ${options.output}`);
      logger.info("\n下一步：");
      logger.info("1. 将此文件的内容合并到您的 MCP 客户端配置中");
      logger.info("2. Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json");
      logger.info("3. Cursor: ~/.cursor/mcp.json\n");
    } catch (error: any) {
      logger.error("❌ 生成配置文件失败:", error.message);
      process.exit(1);
    }
  });

/**
 * 清理命令
 */
program
  .command("clean")
  .description("清理本地缓存和 Token")
  .option("--all", "清理所有缓存（包括配置）")
  .action(async (options) => {
    const tokenPath = getTokenPath();
    let cleaned = false;

    // 清理 Token
    if (existsSync(tokenPath)) {
      try {
        await fs.unlink(tokenPath);
        logger.info("✅ 已删除 Token");
        cleaned = true;
      } catch (error: any) {
        logger.error("❌ 删除 Token 失败:", error.message);
      }
    }

    if (options.all) {
      logger.info("清理所有缓存...");
      // 可以添加更多清理逻辑
    }

    if (!cleaned) {
      logger.info("没有需要清理的内容");
    }
  });

// 解析命令行参数
program.parse();

// 如果没有参数，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
