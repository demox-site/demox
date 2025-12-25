# CloudHost（基于 CloudBase 的极速静态站部署平台）

[![Powered by CloudBase](https://7463-tcb-advanced-a656fc-1257967285.tcb.qcloud.la/mcp/powered-by-cloudbase-badge.svg)](https://github.com/TencentCloudBase/CloudBase-AI-ToolKit)

## 概述
- CloudHost 是一个面向开发者的“拖拽上传、一键部署、全球 CDN 分发”的静态网站托管平台。
- 前端基于 `Vite + React + TypeScript + Tailwind + Shadcn/Radix UI` 构建，后端核心服务基于腾讯云云开发（CloudBase）与云函数实现。
- 通过 CloudBase 数据库记录部署元信息，通过 COS（对象存储）托管静态网站，支持角色限额、站点重部署、删除、统计与成本估算。
- 项目同时集成了 CloudBase AI ToolKit 与 MCP 能力，便于通过 AI 辅助开发与自动化运维。

## 能做什么
- 拖拽或选择 `.zip` 项目包上传，自动解压并部署至 COS，生成可访问的站点地址。
- 支持“重新部署”功能，对既有站点进行覆盖式更新。
- 支持站点列表展示、站点名称编辑、站点删除（同时清理 COS 与数据库记录）。
- 支持角色与配额管理：不同角色可配置最大文件大小、文件数、部署数量、可用文件扩展名、是否启用等。
- 提供管理员可见的“运营大盘”，展示站点总存储量、对象数、在用用户与项目数、以及 COS 流量（天/小时级时间序列）。
- 具备简单的成本估算：以站点存储量与最近一天外网下行为基准估算当日费用。

## 牛逼的点
- 极简的用户路径：无需复杂配置，上传 `.zip` 即完成部署，自动生成访问域名。
- 全服务端鉴权与限额：核心限额与权限校验完全在云函数侧执行，前端只负责调度，安全稳定。
- 自动推断并设置缓存策略：`HTML` 强制不缓存，其它静态资源按 1 年不可变缓存，保证性能与一致性。
- 站点路径规范化与隔离：按 `sites/<userId>/<websiteId>/<name-no-ext>/...` 组织，隔离用户与项目，避免冲突。
- 实时运营洞察：集成 COS 监控 API，形成流量时间序列，方便容量与费用评估。
- 角色系统灵活：可配置角色维度使用限额，绑定用户角色，支持优先级选择“最高权限生效”。

## 技术栈
- 前端：`React 18`、`TypeScript`、`Vite 5`、`TailwindCSS`、`Shadcn UI`、`Radix UI`、`TanStack Query`
- 云开发：`@cloudbase/js-sdk`（前端）与 `@cloudbase/node-sdk`（云函数）
- 云函数：`Node.js`，依赖 `adm-zip` 解压、`cos-nodejs-sdk-v5` 上传、`tencentcloud-sdk-nodejs` 查询 COS 监控
- 存储与托管：腾讯云 COS
- 数据库：CloudBase 文档库（NoSQL）

## 核心服务
- 云函数 `deploy-website`（cloudfunctions/deploy-website/index.js）是部署与资源管理的核心：
  - `list`：按用户查询站点列表（`resource-game` 集合），见 `cloudfunctions/deploy-website/index.js:466`
  - `bucket_stats`：统计 `sites/` 前缀的总体积与数量，统计在用用户/项目数，并拉取 COS 流量时间序列，见 `cloudfunctions/deploy-website/index.js:486`
  - `update_name`：更新站点文档的 `name` 字段（带用户归属校验），见 `cloudfunctions/deploy-website/index.js:519`
  - `delete`：删除站点对应的 COS 前缀并清理数据库记录，见 `cloudfunctions/deploy-website/index.js:551`
  - `sync_cos_to_db`：遍历 COS 目录，将缺失的站点写回数据库，见 `cloudfunctions/deploy-website/index.js:663`
  - `upload_and_deploy`：前端上传 `.zip` 后端解压部署，写入/更新数据库并返回访问 URL，见 `cloudfunctions/deploy-website/index.js:751`
- 云函数 `getRoleLimits`（cloudfunctions/getRoleLimits/index.js）用于读取角色限额，避免前端直查造成 ACL 风险，见 `cloudfunctions/getRoleLimits/index.js:10`

## 架构设计
- 路径与域名
  - 站点存储路径：`sites/<userId>/<websiteId>/<fileNameNoExt>/...`
  - 站点访问域名：`https://sites-<userId>-<websiteId>-<fileNameNoExt>.yourdomain.com/index.html`
  - `websiteId` 规范为 8 位大写字母与数字（不合规则自动生成），见 `cloudfunctions/deploy-website/index.js:207`
  - `fileNameNoExt` 取上传文件名的无扩展名段，非字母数字统一回落为 `dist`，见 `cloudfunctions/deploy-website/index.js:222`
- 缓存策略
  - `HTML`：`no-cache, no-store, must-revalidate`，确保最新
  - 其他静态资源：`public, max-age=31536000, immutable`，一年不可变长缓存
- 角色与限额
  - 用户绑定：`ai_builder_user_roles`（文档 `docId = uid`，字段 `role: string[]`）
  - 角色定义：`ai_builder_roles`（`name/_id`、`priority`、`max_file_size`、`deployment_limit`、`max_file_count`、`allowed_extensions`、`enabled`）
  - 生效策略：当存在多角色时选“优先级最高”的一条为生效限额，见 `cloudfunctions/deploy-website/index.js:58` 与 `src/pages/home.jsx:218`
- 安全与鲁棒性
  - 路径清洗、防目录穿越、防 macOS 隐藏目录、限制扩展名与文件数、启停开关等
  - 所有关键操作（部署/删除/重部署/改名）均在后端执行并校验

## 目录结构（精选）
```
ai-builder/
├─ src/                    # 前端源码
│  ├─ pages/               # 业务页面（首页、部署、大盘、价格、日志等）
│  ├─ components/ui/       # Shadcn/Radix UI 组件封装
│  ├─ lib/
│  ├─ configs/             # 路由与环境配置（envId）
│  └─ cloudbase.ts         # CloudBase 前端 SDK 初始化
├─ cloudfunctions/         # 云函数
│  ├─ deploy-website/
│  │  ├─ index.js          # 页面托管核心逻辑
│  │  └─ package.json
│  └─ getRoleLimits/
│     └─ index.js          # 角色限额读取
└─ package.json            # 前端依赖与脚本
```

## 快速开始
- 环境：`Node.js 18+`，`pnpm/npm` 均可
- 配置环境 ID：修改 `src/configs/env.ts` 中的 `env` 值为你的 CloudBase 环境 ID
- 安装依赖
  - `npm install`
- 本地开发
  - `npm run dev`
- 构建生产包
  - `npm run build`
- 本地预览
  - `npm run preview`

## 部署与发布
- 云函数部署（参考 CloudBase 工具链或平台控制台）：
  - 部署 `deploy-website` 与 `getRoleLimits` 两个函数至你的环境
  - `deploy-website` 需具备访问 COS 的临时密钥权限（默认通过云函数运行环境获取），也可配置 `COS_SECRET_ID/KEY`
- EdgeOne 配置：
  - 在腾讯云 EdgeOne 控制台添加域名 `yourdomain.com`。
  - 配置泛域名解析 `*.yourdomain.com`。
  - 编写并部署边缘函数，实现从 `sites-<uid>-<wid>-<name>` 到 `sites/<uid>/<wid>/<name>` 的路径重写逻辑。
- COS 存储桶配置：
  - **CORS 设置**：需在 COS 控制台配置跨域访问（CORS）规则，允许来源 Origin 为 `https://*.yourdomain.com`，允许 Methods 为 `GET, HEAD`，以确保字体文件或跨域脚本能被正确加载。
  - **权限设置**：确保存储桶具备公有读权限（或配置回源鉴权），以便 EdgeOne 能顺利拉取资源。
- 静态网站访问：
  - 默认域名：`yourdomain.com`，站点子域名按约定自动生成
  - 访问地址示例：`https://sites-<uid>-<wid>-<name>.yourdomain.com/index.html`
- 注意：
  - CDN/缓存生效可能存在数分钟延迟
  - 变更 HTML 会立刻生效（不缓存），变更 JS/CSS 等需等待缓存策略到期或改名防止旧缓存


## 常见问题
- 上传失败或类型不支持？
  - 请确认 `.zip` 根目录包含 `index.html`，且文件扩展名在允许列表内（由角色限额配置）。
- 访问地址 404？
  - 请确认部署路径下存在 `index.html`，或检查是否将 `index.html` 写入到子目录导致路径不匹配。

## 许可
- 代码以仓库声明的协议为准。

