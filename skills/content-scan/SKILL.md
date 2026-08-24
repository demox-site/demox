---
name: demox-content-scan
description: Look up Demox blocked phrases and the public content-scan API before deploying a site. Use when the user mentions 屏蔽词, blocklist, content scan, 内容审核, illegal content, or a Demox deploy failed with CONTENT_BLOCKED.
---

# Demox 屏蔽词查询

部署前 Demox 会用本地短语匹配扫描上传包。完整词表对用户和 Agent 公开，无需登录。

## 先读文档，再调接口

1. 人看的页面：https://www.demox.site/content-scan
2. 文档章节：https://www.demox.site/doc#doc-moderation
3. 查全部屏蔽词（优先这条）：

```bash
curl -s https://api.demox.site/website/content-scan/phrases
```

等价 POST：

```bash
curl -s -X POST https://api.demox.site/website/content-scan/phrases \
  -H 'Content-Type: application/json' \
  -d '{"action":"list_blocked_phrases"}'
```

静态副本（主站发布即可用，不依赖云函数）：https://www.demox.site/content-scan.json

## 返回里看什么

- `phrases`：扁平数组，部署扫描用的全部词
- `groups`：按 politics / porn / gambling / contraband 分组
- `count`、`updatedAt`、`docs`、`skill`
- 图片不在词表里，走腾讯云 IMS

发布失败且 `code` 为 `CONTENT_BLOCKED` 时，`message` 会写出命中的具体词。改掉该词后重试，不要猜测词表。
