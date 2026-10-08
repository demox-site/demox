# 纸鹤 CLI · 快速开始

> 纸鹤（Zhihe）是一个虚构的命令行小工具，用来把文件夹里的图片批量压缩、改名、打水印。
>
> 这是 Demox 的公开示例：把一份 `.md` 使用文档发成带目录、适合分享的网页（insight 模板）。

**适用版本** 纸鹤 2.x · **阅读时间** 约 3 分钟 · **最后更新** 2026-10-07

## 你会得到

- 一条命令把整个文件夹的图片压缩到合适大小
- 按模板批量改名，不再有 `IMG_4031.JPG`
- 可选的右下角文字水印
- 原图永远不动，结果统一放在 `./zhihe-out/`

## 安装

需要 Node.js 18 或更高版本。

```bash
npm install -g zhihe-cli
zhihe --version
```

看到类似 `zhihe 2.3.1` 的版本号就说明装好了。公司电脑如果没有全局安装权限，用 `npx zhihe-cli` 也可以。

## 三分钟跑通

1. 进到放图片的文件夹：`cd ~/Pictures/trip`
2. 预览会做什么，不真正改文件：

   ```bash
   zhihe run --dry
   ```

3. 确认没问题后执行：

   ```bash
   zhihe run --quality 80 --rename "trip-{n}"
   ```

处理后的文件放在 `./zhihe-out/`，原图不动。

## 常用参数

| 参数 | 作用 | 默认 |
| --- | --- | --- |
| `--quality` | 压缩质量，1–100 | `82` |
| `--max-width` | 超过这个宽度就等比缩小 | 不限制 |
| `--rename` | 改名模板，`{n}` 是序号，`{date}` 是拍摄日期 | 不改名 |
| `--watermark` | 右下角水印文字 | 无 |
| `--dry` | 只打印计划，不写文件 | 关 |

## 配置文件

参数多了可以写进项目根目录的 `zhihe.config.json`：

```json
{
  "quality": 78,
  "maxWidth": 2400,
  "rename": "{date}-{n}",
  "watermark": "© 小林的相册"
}
```

命令行参数优先级高于配置文件。

## 一个完整的例子

把旅行照片压到 2400 像素宽、按日期改名、加水印：

```bash
zhihe run --max-width 2400 --rename "{date}-{n}" --watermark "© 小林的相册"
```

| 处理前 | 处理后 |
| --- | --- |
| `IMG_4031.JPG` · 6.2 MB | `2026-09-14-001.jpg` · 820 KB |
| `IMG_4032.JPG` · 5.8 MB | `2026-09-14-002.jpg` · 790 KB |

## 常见问题

**处理 HEIC 报错？** 先运行 `zhihe doctor`，按提示装好解码器。

**能不能直接覆盖原图？** 可以加 `--in-place`，但建议先用 `--dry` 看一遍。

**怎么卸载？** `npm uninstall -g zhihe-cli`，配置文件需要手动删除。

## 下一步

- `zhihe help run` 查看全部参数
- 遇到问题，把 `zhihe doctor` 的输出贴到 issue 里
