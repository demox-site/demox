# 封禁站点公开侧复测：2026-10-17

被处理站点 `1791141127876590527` 及其 5 个子域名，在删除对象并清 EdgeOne 缓存后的公开侧可达性复测。

结论：**公开侧通过**——5 个子域名 https 全部 403，源站路径 404 取不到内容，主站 200 正常。但 403 靠封禁标记、404 靠对象已删，两者都不是回源兜底，见文末。

## 命令

```bash
# 5 个子域名，http 与 https 各一轮
for h in MUELLII3 KXT8244Z MNIYUVN8 VMPZGKSR WAB5W9J7; do
  for scheme in http https; do
    curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -m 12 \
      -A "Mozilla/5.0" "$scheme://$h.demox.site/"
  done
done

# 三个入口
for u in https://demox.site/ https://www.demox.site/ \
         https://demox.site/sites/1791141127876590527/; do
  curl -sL -o /dev/null -w "%{http_code} -> %{url_effective}\n" -m 15 \
    -A "Mozilla/5.0" "$u"
done
```

## 子域名

| 子域名 | http | https |
| --- | --- | --- |
| `MUELLII3.demox.site` | 301 到 https（子域名小写化） | **403** |
| `KXT8244Z.demox.site` | 301 到 https | **403** |
| `MNIYUVN8.demox.site` | 301 到 https | **403** |
| `VMPZGKSR.demox.site` | 301 到 https | **403** |
| `WAB5W9J7.demox.site` | 301 到 https | **403** |

5/5 无可访问内容。

## 入口

| 入口 | 结果 | 读法 |
| --- | --- | --- |
| `https://demox.site/` | 200（301 到 www） | 主站正常 |
| `https://www.demox.site/` | 200 | 主站正常 |
| `https://demox.site/sites/1791141127876590527/` | 404 | 源站路径取不到对象，无内容泄露 |

## 这组数字的含义

403 来自封禁标记，404 来自对象已被删。两种都是「事后状态」，不是回源时的判定：

- 只要以后有对象漏删、缓存没清干净、或路径拼错，内容就直接露出来了
- 封禁标记失效时，被删对象之外的东西同样没有第二道防线

所以要补的是**回源按站点 ID 判封禁/私有、查询失败即拒绝**（K0–K2）。这是独立需求 REQ-27，不在本次复测范围内。

## 未覆盖

- **未封禁站点的回归对照**：手头没有已知正常的站点子域名，所以「403 没有误伤正常站点」这一点没验证过。下次复测应带一个已知正常的子域名一起扫。
- **对象是否真的删干净**：从外部只能看到 404，看不到对象存储列表。要确认得在云侧列一次 `sites/1791141127876590527/` 前缀。
