#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OAuthManager } from "./auth/OAuthManager.js";
import { DemoxClient } from "./api/DemoxClient.js";
import { logger } from "./utils/config.js";

/**
 * Demox MCP Server
 *
 * 提供 Demox 平台的 MCP 接口，支持：
 * - 部署静态网站
 * - 查看网站列表
 * - 删除网站
 * - 管理网站
 */
class DemoxMCPServer {
  private server: Server;
  private oauthManager: OAuthManager;
  private demoxClient: DemoxClient | null = null;

  constructor() {
    logger.info("正在初始化 Demox MCP Server...");

    this.server = new Server(
      {
        name: "@demox/mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.oauthManager = new OAuthManager();

    this.setupHandlers();
  }

  /**
   * 设置请求处理器
   */
  private setupHandlers(): void {
    // 工具列表
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "deploy_website",
            description:
              "部署静态网站到 Demox 平台。支持传入本地文件路径、目录路径、ZIP 文件或 URL，系统会自动处理打包和上传。",
            inputSchema: {
              type: "object",
              properties: {
                zipFile: {
                  type: "string",
                  description:
                    "文件或目录路径。支持：1) 本地目录（如 ./dist）- 自动打包 2) ZIP 文件（如 ./site.zip）- 直接上传 3) HTTP/HTTPS URL - 下载后部署 4) base64 编码的 ZIP 内容",
                },
                websiteId: {
                  type: "string",
                  description:
                    "网站 ID（可选）。如果不提供，将创建新网站；如果提供，将更新现有网站",
                },
                fileName: {
                  type: "string",
                  description: "网站名称，用于标识和展示。如果不提供，会自动使用目录或文件名",
                },
              },
              required: ["zipFile"],
            },
          },
          {
            name: "list_websites",
            description:
              "获取用户在 Demox 平台上的所有网站列表，包括网站 ID、名称、URL 和创建时间",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "get_website",
            description:
              "获取指定网站的详细信息，包括文件列表、部署历史等",
            inputSchema: {
              type: "object",
              properties: {
                websiteId: {
                  type: "string",
                  description: "要查询的网站 ID",
                },
              },
              required: ["websiteId"],
            },
          },
          {
            name: "delete_website",
            description:
              "删除指定的网站及其所有文件。此操作不可撤销，请谨慎使用。",
            inputSchema: {
              type: "object",
              properties: {
                websiteId: {
                  type: "string",
                  description: "要删除的网站 ID",
                },
              },
              required: ["websiteId"],
            },
          },
        ],
      };
    });

    // 工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // 确保已认证
        let accessToken = await this.oauthManager.ensureAuthenticated();

        // 延迟初始化客户端（需要 Token）
        if (!this.demoxClient) {
          this.demoxClient = new DemoxClient(accessToken);
        }

        // 路由到具体的处理方法
        switch (name) {
          case "deploy_website":
            return await this.handleDeploy(args, accessToken);
          case "list_websites":
            return await this.handleList(accessToken);
          case "get_website":
            return await this.handleGet(args, accessToken);
          case "delete_website":
            return await this.handleDelete(args, accessToken);
          default:
            throw new Error(`未知工具: ${name}`);
        }
      } catch (error: any) {
        logger.error(`工具调用失败 (${name}):`, error.message);

        // 检查是否是认证错误
        const isAuthError = error.message.includes("Token") ||
                            error.message.includes("认证") ||
                            error.message.includes("登录") ||
                            error.message.includes("UNAUTHORIZED") ||
                            error.message.includes("401");

        if (isAuthError) {
          logger.info("检测到认证错误，自动触发登录流程...");

          try {
            // 自动触发登录
            const newAccessToken = await this.oauthManager.authorize();

            // 重新初始化客户端
            this.demoxClient = new DemoxClient(newAccessToken);

            logger.info("登录成功，正在重试工具调用...");

            // 重新执行工具调用
            switch (name) {
              case "deploy_website":
                return await this.handleDeploy(args, newAccessToken);
              case "list_websites":
                return await this.handleList(newAccessToken);
              case "get_website":
                return await this.handleGet(args, newAccessToken);
              case "delete_website":
                return await this.handleDelete(args, newAccessToken);
              default:
                throw new Error(`未知工具: ${name}`);
            }
          } catch (loginError: any) {
            logger.error("自动登录失败:", loginError.message);
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **自动登录失败**

错误信息: ${loginError.message}

请尝试手动运行以下命令完成登录：

\`\`\`bash
demox-mcp login
\`\`\`

登录完成后，请重新调用此工具。`,
                },
              ],
              isError: true,
            };
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `❌ 错误: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 处理网站部署
   */
  private async handleDeploy(args: any, accessToken: string) {
    const { zipFile, websiteId, fileName: providedFileName } = args;

    // 参数验证
    if (!zipFile) {
      throw new Error("缺少必需参数: zipFile");
    }

    // 如果没有提供 fileName，尝试从路径推断
    let fileName = providedFileName;
    if (!fileName) {
      if (zipFile.includes("/") || zipFile.includes("\\")) {
        // 是路径：提取目录名或文件名
        const parts = zipFile.split(/\/|\\/);
        const lastPart = parts[parts.length - 1];
        fileName = lastPart.replace(".zip", "") || "unnamed";
      } else {
        fileName = "unnamed";
      }
    }

    logger.info(`开始部署网站: ${fileName}`);

    const result = await this.demoxClient!.deployWebsite(
      {
        zipFile,
        websiteId,
        fileName,
      },
      accessToken
    );

    return {
      content: [
        {
          type: "text",
          text: `✅ 网站部署成功！

**网站名称**: ${fileName}
**网站 ID**: ${result.websiteId}
**访问地址**: ${result.url}
**部署路径**: ${result.path}

您现在可以访问上述地址查看您的网站了。`,
        },
      ],
    };
  }

  /**
   * 处理网站列表
   */
  private async handleList(accessToken: string) {
    logger.info("获取网站列表");

    const websites = await this.demoxClient!.listWebsites(accessToken);

    if (websites.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "您还没有部署任何网站。\n\n使用 deploy_website 工具来创建您的第一个网站吧！",
          },
        ],
      };
    }

    // 格式化网站列表
    const listText = websites
      .map((site, index) => {
        const date = new Date(site.createdAt).toLocaleString("zh-CN");
        return `${index + 1}. **${site.fileName}**
   - ID: \`${site.websiteId}\`
   - URL: ${site.url}
   - 创建时间: ${date}
`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `📋 您的网站列表（共 ${websites.length} 个）

${listText}`,
        },
      ],
    };
  }

  /**
   * 处理获取网站详情
   */
  private async handleGet(args: any, accessToken: string) {
    const { websiteId } = args;

    if (!websiteId) {
      throw new Error("缺少必需参数: websiteId");
    }

    logger.info(`获取网站详情: ${websiteId}`);

    const website = await this.demoxClient!.getWebsite(
      websiteId,
      accessToken
    );

    if (!website) {
      return {
        content: [
          {
            type: "text",
            text: `未找到网站: ${websiteId}`,
          },
        ],
      };
    }

    const createdDate = new Date(website.createdAt).toLocaleString("zh-CN");
    const updatedDate = new Date(website.updatedAt).toLocaleString("zh-CN");

    return {
      content: [
        {
          type: "text",
          text: `**网站详情**

**名称**: ${website.fileName}
**ID**: \`${website.websiteId}\`
**URL**: ${website.url}
**路径**: ${website.path}
**创建时间**: ${createdDate}
**更新时间**: ${updatedDate}`,
        },
      ],
    };
  }

  /**
   * 处理删除网站
   */
  private async handleDelete(args: any, accessToken: string) {
    const { websiteId } = args;

    if (!websiteId) {
      throw new Error("缺少必需参数: websiteId");
    }

    logger.info(`删除网站: ${websiteId}`);

    await this.demoxClient!.deleteWebsite(websiteId, accessToken);

    return {
      content: [
        {
          type: "text",
          text: `✅ 网站已删除

**网站 ID**: ${websiteId}

⚠️ 注意：此操作不可撤销，网站的所有文件已被永久删除。`,
        },
      ],
    };
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info("✅ Demox MCP Server 已启动");
    logger.info("等待工具调用...");
  }
}

// 启动服务器
const server = new DemoxMCPServer();
server.start().catch((error) => {
  logger.error("服务器启动失败:", error);
  process.exit(1);
});
