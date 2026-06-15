# AGENTS.md

本文件给 AI coding agent 使用，优先级高于面向用户的 README。修改、发布本项目时请先阅读。

## 发布方式

- 本项目不走 Cycor，也不需要手动执行云端发布命令。
- 正式发布方式是：将代码直接推送到 GitHub 仓库的 `master` 分支。
- 推送到 `master` 后会自动触发 GitHub Actions：`.github/workflows/deploy.yml`。
- 该 Action 会安装依赖、执行 `npm run build`，把 `dist/` 打包成 zip，然后调用 Demox 自己的 `/deploy` 接口发布。
- Action 中固定发布到 Demox 平台托管的专属站点/项目：
  - `WEBSITE_ID=EPX2UU43`
  - `WEBSITE_NAME=demox-site`
  - `DEPLOY_URL=https://1307257815-ju8ahprgj9.ap-guangzhou.tencentscf.com/deploy`
- GitHub Actions 通过仓库 Secret `DEMOX_TOKEN` 鉴权；不要把 token 写入代码、文档或命令行参数。

## 后端说明

- Demox 的后端都运行在腾讯云 SCF（云函数）上。
- 前端发布只更新 Demox 主站静态资源；不要误以为推送前端代码会自动更新所有后端云函数。
- 后端相关代码主要在 `scf-code/` 和 `scf-deploy-packages/` 下，涉及 SCF 部署时应先确认具体函数、环境和发布脚本。

## 给 Agent 的发布提醒

- 用户说“发布吧”“上线吧”时，应理解为：检查本地改动是否已提交并推送到 `master`，由 GitHub Action 自动发布。
- 不要尝试用 Cycor 发布本项目。
- 不要临时改 `.github/workflows/deploy.yml` 中的目标站点，除非用户明确要求。
- 发布前建议至少执行 `npm run build`，确认前端构建通过。
