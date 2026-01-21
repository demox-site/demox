/**
 * 配置管理模块
 */

import os from "os";
import path from "path";

export interface MCPConfig {
  clientId: string;
  authUrl: string;
  apiBase: string;
  serverEnv: string;
  cloudFunctionUrl: string;
}

export function loadConfig(): MCPConfig {
  const clientId = process.env.DEMOX_CLIENT_ID || "demox-mcp-client";
  const authUrl =
    process.env.DEMOX_AUTH_URL || "http://localhost:8080/#/mcp-authorize";
  const apiBase = process.env.DEMOX_API_BASE || "https://demox.site";
  const serverEnv = process.env.DEMOX_SERVER_ENV || "moyu-3g5pbxld00f4aead";
  const cloudFunctionUrl =
    process.env.DEMOX_CLOUD_FUNCTION_URL ||
    "https://cb.aigc.sx.cn/cloudfunction/mcp-api";

  return {
    clientId,
    authUrl,
    apiBase,
    serverEnv,
    cloudFunctionUrl,
  };
}

/**
 * Token 存储路径
 */
export function getTokenPath(): string {
  const platform = os.platform();

  let configDir: string;

  if (platform === "darwin") {
    // macOS
    configDir = path.join(os.homedir(), ".demox");
  } else if (platform === "win32") {
    // Windows
    configDir = path.join(os.homedir(), ".demox");
  } else {
    // Linux
    configDir = path.join(os.homedir(), ".demox");
  }

  return path.join(configDir, "token.json");
}

/**
 * 日志工具
 */
export class Logger {
  private debugMode: boolean;

  constructor() {
    this.debugMode = process.env.DEBUG === "demox:*" || process.env.DEBUG === "*";
  }

  debug(message: string, ...args: any[]) {
    if (this.debugMode) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    console.error(`[INFO] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]) {
    console.error(`[WARN] ${message}`, ...args);
  }

  error(message: string, ...args: any[]) {
    console.error(`[ERROR] ${message}`, ...args);
  }
}

export const logger = new Logger();
