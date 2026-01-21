import { loadConfig, logger } from "../utils/config.js";
import cloudbase from "@cloudbase/node-sdk";

/**
 * 部署参数
 */
export interface DeployParams {
  zipFile: string; // base64 编码的 ZIP 文件内容或文件路径
  websiteId?: string;
  fileName: string;
}

/**
 * 部署结果
 */
export interface DeployResult {
  url: string;
  websiteId: string;
  path: string;
}

/**
 * 网站信息
 */
export interface Website {
  websiteId: string;
  fileName: string;
  url: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Demox API 客户端
 * 通过 mcp-api 云函数调用其他云函数
 */
export class DemoxClient {
  private cloudFunctionUrl: string;

  constructor(accessToken?: string) {
    const config = loadConfig();
    this.cloudFunctionUrl = config.cloudFunctionUrl;
  }

  /**
   * 调用云函数（通过 mcp-api HTTP 代理）
   */
  private async callFunction(
    name: string,
    data: Record<string, any>,
    accessToken: string
  ): Promise<any> {
    try {
      logger.debug(`调用云函数: ${name}`);

      // 使用配置的云函数 URL
      logger.debug(`API URL: ${this.cloudFunctionUrl}`);

      const response = await fetch(this.cloudFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          functionName: name,
          data,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const responseData = await response.json();

      // 检查错误
      if (responseData && responseData.error) {
        const error = responseData.error;
        throw new Error(
          `[${error.code}] ${error.message}${error.suggestion ? `\n建议：${error.suggestion}` : ""
          }`
        );
      }

      return responseData;
    } catch (error: any) {
      logger.error(`云函数调用失败 (${name}):`, error.message);
      throw error;
    }
  }

  /**
   * 部署网站
   */
  async deployWebsite(
    params: DeployParams,
    accessToken: string
  ): Promise<DeployResult> {
    logger.info(`正在部署网站: ${params.fileName}`);

    // 处理输入路径（文件、目录或 URL）
    let zipFile = params.zipFile;
    let isLocalFile = false;
    let localFilePath: string | null = null;

    if (zipFile.startsWith("http://") || zipFile.startsWith("https://")) {
      // URL: 下载 ZIP 文件
      logger.debug("检测到 ZIP URL，正在下载...");
      const buffer = await this.downloadZipFileToBuffer(zipFile);
      isLocalFile = true;
      localFilePath = await this.saveBufferToTempFile(buffer);
    } else if (!this.isBase64(zipFile)) {
      // 本地路径：文件或目录
      logger.debug(`检测到本地路径: ${zipFile}`);

      const stat = await this.getPathStat(zipFile);
      if (stat.isDirectory) {
        // 目录：打包成 ZIP
        logger.debug(`检测到目录: ${zipFile}，正在打包...`);
        localFilePath = await this.zipDirectoryToFile(zipFile);
        isLocalFile = true;
      } else if (zipFile.endsWith(".zip")) {
        // ZIP 文件：直接使用
        localFilePath = zipFile;
        isLocalFile = true;
      } else {
        throw new Error(`不支持的文件类型，请提供 .zip 文件或目录`);
      }
    }

    // 检查文件大小（如果已转换为本地文件）
    if (isLocalFile && localFilePath) {
      const fileSize = await this.getFileSize(localFilePath);
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (fileSize > maxSize) {
        // 文件过大，使用 CloudBase Storage 上传
        logger.info(`文件较大 (${(fileSize / 1024 / 1024).toFixed(2)}MB)，使用 CloudBase Storage 上传`);

        const fileId = await this.uploadToCloudBaseStorage(
          localFilePath,
          accessToken
        );

        const result = await this.callFunction(
          "deploy-website",
          {
            action: "upload_and_deploy",
            fileId,
            websiteId: params.websiteId,
            fileName: params.fileName,
          },
          accessToken
        );

        logger.info(`网站部署成功: ${result.url}`);
        return result;
      } else {
        // 文件较小，读取为 base64 并直接上传
        logger.debug(`文件较小 (${(fileSize / 1024).toFixed(2)}KB)，使用 base64 上传`);
        const base64 = await this.readFileAsBase64(localFilePath);
        zipFile = base64;
      }
    }

    const result = await this.callFunction(
      "deploy-website",
      {
        action: "upload_and_deploy",
        fileContentBase64: zipFile,
        websiteId: params.websiteId,
        fileName: params.fileName,
      },
      accessToken
    );

    logger.info(`网站部署成功: ${result.url}`);
    return result;
  }

  /**
   * 获取路径状态信息
   */
  private async getPathStat(
    filePath: string
  ): Promise<{ isFile: boolean; isDirectory: boolean; size: number }> {
    const fs = await import("fs");

    if (!fs.existsSync(filePath)) {
      throw new Error(`路径不存在: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
    };
  }

  /**
   * 获取文件大小
   */
  private async getFileSize(filePath: string): Promise<number> {
    const stat = await this.getPathStat(filePath);
    return stat.size;
  }

  /**
   * 读取文件为 base64
   */
  private async readFileAsBase64(filePath: string): Promise<string> {
    const fs = await import("fs");

    try {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString("base64");
      logger.debug(`文件读取成功，大小: ${buffer.length} 字节`);
      return base64;
    } catch (error: any) {
      throw new Error(`读取文件失败: ${error.message}`);
    }
  }

  /**
   * 将目录打包成 ZIP 文件
   */
  private async zipDirectoryToFile(dirPath: string): Promise<string> {
    const fs = await import("fs");
    const pathModule = await import("path");
    const os = await import("os");
    const AdmZip = await import("adm-zip");

    try {
      const zip = new AdmZip.default();
      zip.addLocalFolder(dirPath);

      // 保存到临时文件
      const tempFile = pathModule.join(
        os.tmpdir(),
        `demox-deploy-${Date.now()}.zip`
      );
      zip.writeZip(tempFile);

      logger.debug(`目录打包成功: ${dirPath} -> ${tempFile}`);
      return tempFile;
    } catch (error: any) {
      throw new Error(`打包目录失败: ${error.message}`);
    }
  }

  /**
   * 上传文件到 CloudBase Storage
   */
  private async uploadToCloudBaseStorage(
    filePath: string,
    accessToken: string
  ): Promise<string> {
    const config = loadConfig();

    // 初始化 CloudBase
    const app = cloudbase.init({
      env: config.serverEnv,
      accessToken,
    });

    try {
      const fs = await import("fs");
      const pathModule = await import("path");

      const fileName = pathModule.basename(filePath);
      const cloudPath = `mcp-uploads/${Date.now()}-${fileName}`;

      logger.info(`正在上传文件到 CloudBase Storage: ${cloudPath}`);

      // 上传文件
      const result = await app.uploadFile({
        cloudPath,
        fileContent: fs.createReadStream(filePath),
      });

      logger.info(`文件上传成功: ${result.fileID}`);
      return result.fileID;
    } catch (error: any) {
      logger.error("上传文件到 CloudBase Storage 失败:", error.message);
      throw new Error(`上传文件失败: ${error.message}`);
    }
  }

  /**
   * 下载 ZIP 文件并保存为 Buffer
   */
  private async downloadZipFileToBuffer(url: string): Promise<Buffer> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`下载失败: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      logger.debug(`ZIP 文件下载成功，大小: ${buffer.length} 字节`);
      return buffer;
    } catch (error: any) {
      logger.error("下载 ZIP 文件失败:", error.message);
      throw error;
    }
  }

  /**
   * 保存 Buffer 到临时文件
   */
  private async saveBufferToTempFile(buffer: Buffer): Promise<string> {
    const fs = await import("fs");
    const pathModule = await import("path");
    const os = await import("os");

    const tempFile = pathModule.join(
      os.tmpdir(),
      `demox-download-${Date.now()}.zip`
    );

    fs.writeFileSync(tempFile, buffer);
    logger.debug(`Buffer 已保存到临时文件: ${tempFile}`);
    return tempFile;
  }

  /**
   * 检查字符串是否是 base64 编码
   */
  private isBase64(str: string): boolean {
    // 简单的 base64 检测
    try {
      return btoa(atob(str)) === str;
    } catch (e) {
      // 如果不是 base64，检查是否是本地路径
      return !str.includes("/") && !str.includes("\\") && str.length > 100;
    }
  }

  /**
   * 列出所有网站
   */
  async listWebsites(accessToken: string): Promise<Website[]> {
    logger.debug("获取网站列表");

    const result = await this.callFunction(
      "deploy-website",
      {
        action: "list",
      },
      accessToken
    );

    // 云函数返回 { files: [...], count: n }
    return result.files || [];
  }

  /**
   * 删除网站
   */
  async deleteWebsite(
    websiteId: string,
    accessToken: string
  ): Promise<void> {
    logger.info(`正在删除网站: ${websiteId}`);

    await this.callFunction(
      "deploy-website",
      {
        action: "delete",
        websiteId,
      },
      accessToken
    );

    logger.info("网站已删除");
  }

  /**
   * 获取网站详情
   */
  async getWebsite(
    websiteId: string,
    accessToken: string
  ): Promise<Website | null> {
    logger.debug(`获取网站详情: ${websiteId}`);

    const result = await this.callFunction(
      "deploy-website",
      {
        action: "get",
        websiteId,
      },
      accessToken
    );

    return result.website || null;
  }

  /**
   * 下载 ZIP 文件并转换为 base64
   */
  private async downloadZipFile(url: string): Promise<string> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`下载失败: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      logger.debug(`ZIP 文件下载成功，大小: ${buffer.byteLength} 字节`);
      return base64;
    } catch (error: any) {
      logger.error("下载 ZIP 文件失败:", error.message);
      throw error;
    }
  }

  /**
   * 验证 Token 有效性
   */
  async verifyToken(accessToken: string): Promise<boolean> {
    try {
      await this.callFunction(
        "oauth-token-manager",
        {
          action: "verify_token",
          accessToken,
        },
        accessToken
      );

      return true;
    } catch (error) {
      logger.error("Token 验证失败:", error);
      return false;
    }
  }
}
