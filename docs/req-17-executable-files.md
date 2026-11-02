# REQ-17 可执行文件：只读存量与新上传拒收

后缀（大小写不敏感）：`.exe` `.msi` `.dmg` `.apk` `.bat` `.ps1`。

这次没有云凭证，**没有线上计数**。下面的夹具只验证脚本会计数，不是生产存量。脚本不删除、不改写已有对象。

## 怎么跑

不访问网络：

```bash
node scripts/inventory-executable-sites.cjs
node scripts/inventory-executable-sites.cjs --fixture scripts/fixtures/executable-site-keys.json
```

只读列出默认桶（密钥放环境变量，不要写进仓库、聊天或日志）：

```bash
npm ci --prefix scf-code/website-api --no-audit --no-fund
COS_SECRET_ID=... COS_SECRET_KEY=... node scripts/inventory-executable-sites.cjs --live
```

也认 `TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY`，或 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`。临时密钥再用 `COS_SESSION_TOKEN`。默认桶 `resource-game-1307257815`，地域 `ap-chengdu`，前缀 `sites/`。其它注册桶换 `COS_BUCKET` 和 `COS_REGION` 再跑一遍。本脚本不连数据库。

`--live` 只调用 COS `getBucket`（ListObjects）。写和删除方法会被换成直接抛错。

## 输出

JSON。`mutate` 恒为 `false`。`siteCount` 是 `sites/{userId}/{websiteId}/` 下至少有一个命中对象的站点数。`objectCount` 是命中对象数。站点前缀以外的命中算进 `ignoredNonSite`，不计入站点数。`mode` 为 `dry-run` 时 `siteCount` 是 `null`。

夹具自检（不是线上）：`siteCount` 4，`objectCount` 7，`ignoredNonSite` 2。四个站是 `SITE0001`、`SITE0003`、`SITE0005`、`SITE0006`。

## 新上传拒收

`init_deploy_upload` 按外层文件名拒收。`upload_and_deploy` 和分块完成都会解开 ZIP，按条目名拒收，并且发生在读库、加锁、上传之前。`deployZipToBucket` 在 `put` 和 prune 之前再拦一次，所以拒收不会改已有站点对象。分块完成若因此失败，只清理这次会话的 `_deploy_uploads/.../*.part`。

错误码 `EXECUTABLE_FILE_REJECTED`。文案说明是可执行文件，并建议放到 GitHub Releases，站点里只放外部下载链接。

部署 ZIP 的条目名会查（含压缩包内的这些后缀）。ZIP 里再套的 ZIP/7z 本次不拆开，留作后续。不会因为内层压缩包本身拒收整个站点。
