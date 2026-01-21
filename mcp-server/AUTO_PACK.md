# ✨ 自动打包功能说明

## 功能概述

现在你只需要提供一个路径，系统会自动识别并处理：

- 📁 **目录**（如 `./dist`）→ 自动打包成 ZIP → 上传
- 📦 **ZIP 文件**（如 `./site.zip`）→ 直接读取 → 上传
- 🌐 **URL**（如 `https://example.com/site.zip`）→ 下载 → 上传
- 🔤 **base64** → 直接使用

---

## 使用示例

### CLI 工具

```bash
# 部署 dist 目录（最常用！）
demox-mcp deploy ./dist

# 部署 build 目录
demox-mcp deploy ./build --name "My Awesome Site"

# 部署 ZIP 文件
demox-mcp deploy ./site.zip

# 部署远程 URL
demox-mcp deploy https://example.com/site.zip
```

### 在 Claude Desktop 中

#### 示例 1: 部署 dist 目录

```
你: 部署 dist 目录

Claude:
检测到目录: ./dist
正在打包目录...
✅ 网站部署成功！

网站名称: dist
访问地址: https://demox.site/ABC12345
```

#### 示例 2: 部署当前项目

```
你: 部署当前项目的 dist 目录

Claude:
我来帮您部署 ./dist 目录
[自动打包并上传]
✅ 部署成功！
```

#### 示例 3: 部署并指定名称

```
你: 把 ./build 目录部署上去，名字叫 "Portfolio 2025"

Claude:
[调用 deploy_website 工具，传入 path: ./build, fileName: "Portfolio 2025"]
✅ 部署成功！
```

### 在 Cursor 中

```
# 在 Chat 中输入

部署 dist 目录

# Cursor 会：
# 1. 检测到是目录
# 2. 自动调用打包
# 3. 上传到 Demox
# 4. 返回 URL
```

### 编程方式

```typescript
import { DemoxClient, OAuthManager } from "@demox/mcp-server";

const oauthManager = new OAuthManager();
const accessToken = await oauthManager.ensureAuthenticated();
const client = new DemoxClient(accessToken);

// 直接传入目录路径
const result = await client.deployWebsite(
  {
    zipFile: "./dist",  // 可以是目录、文件或 URL
    fileName: "My Site",
  },
  accessToken
);

console.log("部署成功:", result.url);
```

---

## 工作流程

### 目录路径（最常用）

```
用户输入: ./dist
    ↓
检测: 是目录
    ↓
操作: 自动打包成 ZIP（内存中）
    ↓
上传: 到云存储
    ↓
完成: 返回访问链接
```

### ZIP 文件

```
用户输入: ./site.zip
    ↓
检测: 是 ZIP 文件
    ↓
操作: 读取文件内容
    ↓
上传: 到云存储
    ↓
完成: 返回访问链接
```

### URL

```
用户输入: https://example.com/site.zip
    ↓
检测: 是 URL
    ↓
操作: 下载文件
    ↓
上传: 到云存储
    ↓
完成: 返回访问链接
```

---

## 智能推断

系统会自动推断网站名称：

| 输入 | 自动名称 |
|------|---------|
| `./dist` | `dist` |
| `./build` | `build` |
| `./my-site` | `my-site` |
| `./site.zip` | `site` |
| `./project.zip` | `project` |

你也可以手动指定：

```bash
demox-mcp deploy ./dist --name "My Custom Name"
```

---

## 常见使用场景

### 场景 1: React 项目

```bash
# 1. 构建
npm run build

# 2. 部署（一行搞定！）
demox-mcp deploy ./dist
```

### 场景 2: Vue 项目

```bash
# 1. 构建
npm run build

# 2. 部署
demox-mcp deploy ./dist --name "My Vue App"
```

### 场景 3: Vite 项目

```bash
# 1. 构建
npm run build

# 2. 部署
demox-mcp deploy ./dist
```

### 场景 4: Next.js 静态导出

```bash
# 1. 构建
npm run build
npm run export

# 2. 部署
demox-mcp deploy ./out
```

### 场景 5: 快速测试

```bash
# 创建简单 HTML 文件
echo "<h1>Hello World</h1>" > index.html

# 部署当前目录
demox-mcp deploy .
```

---

## 优势

### ✅ 极简操作
- 无需手动打包
- 无需记住复杂命令
- 一个路径搞定

### ✅ 智能识别
- 自动检测文件类型
- 自动推断网站名称
- 友好的错误提示

### ✅ 灵活性
- 支持目录、文件、URL
- 支持自定义名称
- 支持更新现有网站

---

## 技术细节

### 目录打包

使用 `adm-zip` 库在内存中打包，不产生临时文件：

```typescript
const zip = new AdmZip();
zip.addLocalFolder(dirPath);
const buffer = zip.toBuffer();
const base64 = buffer.toString("base64");
```

### 路径检测

```typescript
// 检查路径类型
const stat = fs.statSync(path);
if (stat.isDirectory()) {
  // 是目录：打包
} else if (stat.isFile() && path.endsWith(".zip")) {
  // 是 ZIP 文件：读取
}
```

---

## 总结

**以前**：
```bash
# 需要手动打包
zip -r site.zip dist
demox-mcp deploy ./site.zip
```

**现在**：
```bash
# 一行搞定！✨
demox-mcp deploy ./dist
```

**在 AI 工具中**：
```
你: 部署 dist 目录
Claude: [自动完成]
✅ 完成！
```

---

🎉 现在部署变得更简单了！只需要一个路径，剩下的交给系统！
