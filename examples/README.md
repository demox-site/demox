# 官网三个真实示例

对应首页「30 秒看完三个真实示例」。源码在本目录，页面发在 Demox 上。

| 卡片 | 源码 | 发布命令 | 线上 |
| --- | --- | --- | --- |
| Vite + React 构建产物 | `vite-react/` | `npm run build && demox deploy ./dist` | https://example-vite.demox.site |
| 文档变可分享网页 | `markdown/README.md` | `demox deploy README.md --template insight` | https://example-md.demox.site |
| AI 生成页面一键发布 | `ai-html/ai-generated.html` | `demox deploy ./ai-generated.html` | https://example-ai.demox.site |

三个站挂在 `demox` 项目下：

| 前缀 | 网站 ID |
| --- | --- |
| `example-vite` | `TKEMDUR9` |
| `example-md` | `ZRKFJ4JA` |
| `example-ai` | `5ZPQEHV7` |

更新已有站点时带上 `--id`。
