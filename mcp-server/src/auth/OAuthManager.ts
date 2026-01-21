import http from "http";
import { URL } from "url";
import open from "open";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import { dirname } from "path";
import { loadConfig, getTokenPath, logger } from "../utils/config.js";

/**
 * Token 数据结构
 */
export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  userId: string;
  clientId: string;
}

/**
 * OAuth 认证管理器
 */
export class OAuthManager {
  private config: ReturnType<typeof loadConfig>;
  private tokenPath: string;
  private currentToken: TokenData | null = null;

  constructor() {
    this.config = loadConfig();
    this.tokenPath = getTokenPath();
  }

  /**
   * 确保已认证
   * 如果 Token 不存在或过期，自动触发登录流程
   */
  async ensureAuthenticated(): Promise<string> {
    // 尝试从本地加载 Token
    const tokenData = await this.loadToken();

    if (tokenData && !this.isTokenExpired(tokenData)) {
      this.currentToken = tokenData;
      logger.debug("使用本地缓存的 Token");

      // 检查是否即将过期（3天内）
      const daysLeft = Math.floor(
        (tokenData.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (daysLeft <= 3) {
        logger.warn(
          `Token 将在 ${daysLeft} 天后过期，建议重新登录`
        );
      }

      return tokenData.accessToken;
    }

    // Token 不存在或过期，触发登录
    logger.info("Token 不存在或已过期，需要登录");
    return await this.authorize();
  }

  /**
   * 启动 OAuth 授权流程（公开方法，供 CLI 使用）
   */
  async authorize(): Promise<string> {
    logger.info("正在启动登录流程...");

    // 生成随机 state
    const state = this.generateRandomState();

    // 构建授权 URL（手动构建以支持 hash 路由）
    const params = new URLSearchParams();
    params.set("client_id", this.config.clientId);
    params.set("redirect_uri", "http://localhost:39897/callback");
    params.set("response_type", "code");
    params.set("state", state);
    params.set("scope", "website:deploy website:list website:delete website:update");

    const authUrl = `${this.config.authUrl}?${params.toString()}`;

    // 展示 URL 给用户（在启动服务器之前）
    console.error("\n" + "=".repeat(70));
    console.error("🔐 请在浏览器中访问以下 URL 完成登录：");
    console.error("=".repeat(70));
    console.error("\n" + authUrl + "\n");
    console.error("=".repeat(70));
    console.error("💡 提示：复制上面的 URL 到浏览器中打开");
    console.error("⏳ 等待您在浏览器中完成登录...\n");

    // 尝试打开浏览器（可选）
    try {
      await open(authUrl);
    } catch (error) {
      // 如果打开浏览器失败，忽略错误，用户可以手动访问
      logger.debug("无法自动打开浏览器，请手动访问上述 URL");
    }

    try {
      // 等待回调（超时 5 分钟）- 直接返回 Token 数据
      const tokenData = await Promise.race([
        this.startLocalServer(state),
        this.createTimeout(300000),
      ]);

      // 保存 Token（无需交换）
      await this.saveToken(tokenData);

      logger.info("✅ 登录成功！");
      console.error(`Token 已保存到: ${this.tokenPath}\n`);

      return tokenData.accessToken;
    } catch (error: any) {
      logger.error("登录失败:", error.message);
      throw error;
    }
  }

  /**
   * 启动本地 HTTP 服务器接收回调
   */
  private startLocalServer(expectedState: string): Promise<TokenData> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || "", `http://${req.headers.host}`);
        const accessToken = url.searchParams.get("access_token");
        const refreshToken = url.searchParams.get("refresh_token");
        const userId = url.searchParams.get("user_id");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          // 用户取消或出错
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>登录取消</title>
              <meta charset="utf-8">
              <style>
                body { font-family: sans-serif; text-align: center; padding: 50px; }
                .error { color: #ef4444; font-size: 24px; }
              </style>
            </head>
            <body>
              <div class="error">❌ 登录取消</div>
              <p>${error}</p>
              <p>您可以关闭此页面并返回编辑器。</p>
            </body>
            </html>
          `);
          server.close();
          reject(new Error(`OAuth 授权失败: ${error}`));
          return;
        }

        if (accessToken && state) {
          // 验证 state（防止 CSRF 攻击）
          if (state !== expectedState) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("State 不匹配");
            server.close();
            reject(new Error("OAuth state 不匹配，可能存在安全风险"));
            return;
          }

          // 授权成功 - 直接接收 Token
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>登录成功</title>
              <meta charset="utf-8">
              <style>
                body { font-family: sans-serif; text-align: center; padding: 50px; }
                .success { color: #10b981; font-size: 24px; }
              </style>
            </head>
            <body>
              <div class="success">✅ 登录成功！</div>
              <p>您可以关闭此页面并返回编辑器了。</p>
              <p style="color: #666; font-size: 14px;">
                凭证已保存在本地 (~/.demox/token.json)<br>
                有效期：30 天
              </p>
            </body>
            </html>
          `);

          server.close();

          // 直接返回 Token 数据（无需交换）
          const tokenData: TokenData = {
            accessToken,
            refreshToken: refreshToken || accessToken,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 天
            scopes: ["website:deploy", "website:list", "website:delete", "website:update"],
            userId: userId || "",
            clientId: this.config.clientId,
          };

          resolve(tokenData);
        } else {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("缺少必要的参数");
          server.close();
          reject(new Error("缺少必要的 OAuth 参数"));
        }
      });

      server.listen(39897, () => {
        logger.debug("本地服务器已启动，监听端口 39897");
      });

      // 超时处理
      setTimeout(() => {
        server.close();
        reject(new Error("登录超时（5 分钟）"));
      }, 300000);
    });
  }

  /**
   * 从本地加载 Token
   */
  private async loadToken(): Promise<TokenData | null> {
    try {
      if (!existsSync(this.tokenPath)) {
        return null;
      }

      const content = await fs.readFile(this.tokenPath, "utf-8");
      const tokenData = JSON.parse(content);

      logger.debug("成功加载本地 Token");
      return tokenData;
    } catch (error) {
      logger.error("加载本地 Token 失败:", error);
      return null;
    }
  }

  /**
   * 保存 Token 到本地
   */
  private async saveToken(tokenData: TokenData): Promise<void> {
    try {
      const dir = dirname(this.tokenPath);

      // 确保目录存在
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(
        this.tokenPath,
        JSON.stringify(tokenData, null, 2),
        "utf-8"
      );

      this.currentToken = tokenData;
      logger.debug("Token 已保存到本地");
    } catch (error) {
      logger.error("保存 Token 失败:", error);
      throw error;
    }
  }

  /**
   * 检查 Token 是否过期
   */
  private isTokenExpired(tokenData: TokenData): boolean {
    const now = Date.now();
    const expiresAt = tokenData.expiresAt;

    // 提前 5 分钟判断为过期，避免临界时间
    return now >= expiresAt - 5 * 60 * 1000;
  }

  /**
   * 生成随机 state
   */
  private generateRandomState(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * 创建超时 Promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error("操作超时")), ms);
    });
  }

  /**
   * 撤销当前 Token（登出）
   */
  async revokeToken(): Promise<void> {
    try {
      if (existsSync(this.tokenPath)) {
        await fs.unlink(this.tokenPath);
        logger.info("已删除本地 Token");
      }

      this.currentToken = null;
    } catch (error) {
      logger.error("删除 Token 失败:", error);
      throw error;
    }
  }

  /**
   * 获取当前 Token
   */
  getCurrentToken(): TokenData | null {
    return this.currentToken;
  }
}
