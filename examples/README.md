# 官网真实示例

首页作品墙里的站点。源码在本目录，页面发在 Demox 上（项目 `demox`，ID `PJ65PM8AQ8`）。所有品牌、人物和文案均为虚构，插图为 CSS/SVG 自绘。

| 卡片 | 源码 | 发布命令 | 线上 |
| --- | --- | --- | --- |
| Vite + React 构建产物 | `vite-react/` | `npm run build && demox deploy ./dist` | https://beixian-lighting.demox.site |
| 文档变可分享网页 | `markdown/README.md` | `demox deploy README.md --template insight` | https://field-weather-manual.demox.site |
| AI 生成页面一键发布 | `ai-html/ai-generated.html` | `demox deploy ./ai-generated.html` | https://night-bus-riverside.demox.site |
| 单页小工具 · 晚风番茄钟 | `tool/` | `demox deploy ./tool` | https://wanfeng-pomodoro.demox.site |
| 作品集 · 客户评审 | `portfolio/` | `demox deploy ./portfolio` | https://yuanshan-design.demox.site |
| 使用文档 · insight | `docs/README.md` | `demox deploy docs/README.md --template insight` | https://zhihe-cli-docs.demox.site |
| 随笔博客 · warm | `essay/README.md` | `demox deploy essay/README.md --template warm` | https://letters-from-the-hill.demox.site |
| 更新日志 · dark | `changelog/CHANGELOG.md` | `demox deploy changelog/CHANGELOG.md --template dark` | https://qimu-notes-changelog.demox.site |

这些站都挂在 `demox` 项目下：

| 前缀 | 网站 ID |
| --- | --- |
| `beixian-lighting` | `TKEMDUR9` |
| `field-weather-manual` | `ZRKFJ4JA` |
| `night-bus-riverside` | `5ZPQEHV7` |
| `wanfeng-pomodoro` | `E87YMCF3` |
| `yuanshan-design` | `Y8JPB3SR` |
| `zhihe-cli-docs` | `KI6VVGPO` |
| `letters-from-the-hill` | `LCJAIAC0` |
| `qimu-notes-changelog` | `85Y8VC3X` |

更新已有站点时带上 `--id`。
