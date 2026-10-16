# www 规范链接（canonical）

只影响主站 `www.demox.site`（站点 `EPX2UU43`）的静态构建。用户子域名、`sites.demox.site` 路径和自定义域不走这套页面。

主 URL 是 `https://www.demox.site`。apex `demox.site` 已在边缘 301 到 www。sitemap、robots 和预渲染页的 canonical 都用 www。

## `.md` 镜像

`scripts/generate-seo-pages.mjs` 为每个可索引页写一份 `text/markdown` 镜像（`/pricing.md`、`/zh/index.md` 等），HTML 用 `<link rel="alternate" type="text/markdown">` 指向它。这些 URL 和 HTML 正文重复，响应里没有 canonical，也没有 `X-Robots-Tag`。

静态发布（`demox deploy ./dist` → `deployZipToBucket`）只按扩展名写 Content-Type，并写一条 Cache-Control。没有按文件设置 `Link` 或 `X-Robots-Tag` 的入口，仓库里也没有 `_headers` / headers 清单会被这条管线读进去。因此不能在 `.md` 响应上加 canonical 头。

采用的办法：只在 `public/robots.txt` 的 `User-agent: *` 组加

```
Disallow: /*.md$
```

Googlebot 没有单独分组，会用 `*`，于是不再抓这些镜像。GPTBot、ClaudeBot、PerplexityBot、Google-Extended 等有自己的组，规则不从 `*` 继承，它们的 `Allow: /` 保持不变，LLM / GEO 仍可读 `.md`。

不在 Markdown 正文里塞 `<link rel="canonical">`。`text/markdown` 不会被当成 HTML canonical。

## 别名页

`WWW_SPA_ROUTES` 里没有对应文件的路径，边缘在回源 404 后会回退到根上的 `index.html`，那份壳的 canonical 是首页 `/`。预渲染补上真实文件后，回源直接 200，不再套首页壳。

| 路径 | 处理 |
| --- | --- |
| `/docs` | 与 `/doc` 相同的正文，canonical `https://www.demox.site/doc` |
| `/home` | 与首页相同的正文，canonical `https://www.demox.site/` |
| `/index` | 保持 canonical `https://www.demox.site/` |
| `/admin`、`/mcp`、`/layout-demo` | `noindex, nofollow`（与 `NOINDEX_ROUTES` 相同：不进 sitemap、不写 JSON-LD） |

别名不进 sitemap，也不另写 `.md`。`/docs` 的 markdown alternate 仍指向已有的 `/doc.md`，`/home` 指向 `/index.md`。

## 不在这次改

尾斜杠、`index.html`、`//` 这类 www 变体的 301 另开 PR。不要为这件事改 `edge-functions/`（master 上的 K2 路由是冻结、未发布的）。

## 发布与回滚

合并到 `master` 后，`deploy.yml` 会因 `public/**` 和 `scripts/generate-seo-pages.mjs` 构建并 `demox deploy ./dist --id EPX2UU43`。这次不要手工跑部署。

回滚：revert 该提交，让 `deploy.yml` 重新构建 www；或把上一份 `dist` 再部署一次。不要改边缘函数。

## 发布后核对

```sh
curl -sI https://www.demox.site/robots.txt | head -n 20
curl -s https://www.demox.site/robots.txt | sed -n '/User-agent: \*/,/^$/p'

for path in /docs /home /index /admin /mcp /layout-demo /doc /pricing.md /index.md /zh/index.md; do
  echo "== $path"
  curl -sI "https://www.demox.site$path" | head -n 15
  curl -s "https://www.demox.site$path" | grep -E 'rel="canonical"|noindex' || true
done
```

期望：

- `/docs` 的 canonical 是 `https://www.demox.site/doc`（目录形式 `/docs/` 同理，文件在 `docs/index.html`）。
- `/home` 和 `/index` 的 canonical 是 `https://www.demox.site/`。
- `/admin`、`/mcp`、`/layout-demo` 是 `noindex, nofollow`，canonical 不是首页 `/`。
- `User-agent: *` 含 `Disallow: /*.md$`；GPTBot 那一组没有这条。
- `.md` 仍是 200，正文仍是 Markdown。通用爬虫按 robots 不抓；AI 爬虫组仍允许。
