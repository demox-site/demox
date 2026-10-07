# 官网真实示例

首页作品墙里的站点。源码在本目录，页面发在 Demox 上（项目 `demox`，ID `PJ65PM8AQ8`）。所有品牌、人物和文案均为虚构，插图为 CSS/SVG 自绘。

| 卡片 | 源码 | 发布命令 | 线上 |
| --- | --- | --- | --- |
| Vite + React 构建产物 | `vite-react/` | `npm run build && demox deploy ./dist` | https://example-vite.demox.site |
| 文档变可分享网页 | `markdown/README.md` | `demox deploy README.md --template insight` | https://example-md.demox.site |
| AI 生成页面一键发布 | `ai-html/ai-generated.html` | `demox deploy ./ai-generated.html` | https://example-ai.demox.site |
| 单页小工具 · 晚风番茄钟 | `tool/` | `demox deploy ./tool` | https://example-tool.demox.site |
| 作品集 · 客户评审 | `portfolio/` | `demox deploy ./portfolio` | https://example-portfolio.demox.site |
| 使用文档 · insight | `docs/README.md` | `demox deploy docs/README.md --template insight` | https://example-docs.demox.site |
| 随笔博客 · warm | `essay/README.md` | `demox deploy essay/README.md --template warm` | https://example-essay.demox.site |
| 更新日志 · dark | `changelog/CHANGELOG.md` | `demox deploy changelog/CHANGELOG.md --template dark` | https://example-changelog.demox.site |

这些站都挂在 `demox` 项目下：

| 前缀 | 网站 ID |
| --- | --- |
| `example-vite` | `TKEMDUR9` |
| `example-md` | `ZRKFJ4JA` |
| `example-ai` | `5ZPQEHV7` |
| `example-tool` | `E87YMCF3` |
| `example-portfolio` | `Y8JPB3SR` |
| `example-docs` | `KI6VVGPO` |
| `example-essay` | `LCJAIAC0` |
| `example-changelog` | `85Y8VC3X` |

更新已有站点时带上 `--id`。
