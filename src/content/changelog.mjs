// Demox changelog data. Wording moved verbatim from the original inline JSX in src/pages/log.tsx.
// Every user-visible text is a { zh, en } pair (the repo's i18n pattern, accepted by
// scripts/check-hardcoded-cjk.mjs). Where the old page had no English translation, en repeats
// the original text, which is exactly what the old page showed in English mode.
// version: "current" renders as v${siteConfig.version} (same as before the refactor).

export const LOG_SECTION_TITLE = "It Works on My Machine";
export const LOG_SECTION_SUBTITLE = {
  zh: "已上线",
  en: "Live",
};
export const LOG_TAGLINE = "changelog.md but make it";
export const LOG_TAGLINE_ACCENT = "fashion";
export const LOG_FOOTER = {
  zh: "本站由 Demox 强力驱动（禁止套娃部署本站）",
  en: "Powered by Demox (please do not recursively deploy this site)",
};

/** Change categories used by the filter chips. Every tag in RELEASES maps to exactly one. */
export const TAG_CATEGORY = {
  Feature: "feature",
  Analytics: "feature",
  Privacy: "feature",
  Security: "feature",
  Brand: "feature",
  SEO: "feature",
  Fix: "fix",
  UX: "ux",
  Style: "ux",
  Infra: "infra",
  CI: "infra",
  Refactor: "infra",
  Optim: "infra"
};

export const CATEGORY_ORDER = ["feature", "fix", "ux", "infra"];

export const RELEASES = [
  {
    version: "current",
    name: {
      zh: "换了张脸 (New Face)",
      en: "New Face",
    },
    date: "2026-10-08",
    dateNote: {
      zh: "(首页终于不是那张旧的了)",
      en: "(the homepage is finally not the old one)",
    },
    features: [
      {
        tag: "Style",
        title: {
          zh: "新首页上线",
          en: "New homepage",
        },
        desc: {
          zh: "www 在 14:09 换成新首页。第一屏是能改代码、右边跟着变的编辑器，第二屏地球可以拖着转，第三屏是示例站卡片墙。",
          en: "www switched to the new homepage at 14:09. Screen one is an editor you can type in, with the preview updating beside it; screen two is a globe you can drag; screen three is a wall of example-site cards.",
        },
        note: {
          zh: "三屏都在，旧的那张脸退休了。",
          en: "All three screens made it. The old face is retired.",
        },
      },
      {
        tag: "Fix",
        title: {
          zh: "部署不再互相拆台",
          en: "Deploys stopped stepping on each other",
        },
        desc: {
          zh: "website-api v11 在 12:31 上线。同一个站同时发起两次部署时，现在会锁住一次，不会再互相删文件。不存在的页面返回 404 之后也不再被缓存，站刚部署好不用再干等一分钟。",
          en: "website-api v11 went out at 12:31. Two deploys of the same site at once now take turns instead of deleting each other's files. A missing page's 404 is no longer cached, so a site that just deployed doesn't sit there for a minute.",
        },
        note: {
          zh: "来自 PR #4。",
          en: "From PR #4.",
        },
      },
      {
        tag: "Infra",
        title: {
          zh: "部署更稳",
          en: "Deploys got steadier",
        },
        desc: {
          zh: "同一版里，地理位置改成从磁盘查，不再整包装进内存。切换版本时不再因为内存不够而失败。",
          en: "In the same release, location lookup now reads from disk instead of loading the whole set into memory. Switching versions no longer fails because it ran out of memory.",
        },
        note: {
          zh: "服务器松了一口气。",
          en: "The server can breathe again.",
        },
      },
    ],
  },
  {
    version: "current",
    name: {
      zh: "偷窥自己 (Know Thy Traffic)",
      en: "Know Thy Traffic",
    },
    date: "2026-06-22",
    dateNote: {
      zh: "(终于知道链接有没有人点了)",
      en: "(finally, you can tell whether anyone clicked your link)",
    },
    features: [
      {
        tag: "Analytics",
        title: {
          zh: "独立站点分析页",
          en: "Per-site analytics",
        },
        desc: {
          zh: "每个站点现在都有单独的分析页面，展示实时访问趋势、来源页面、访问路径、国家/省级地区分布和可视化地图。统计走边缘异步上报，不拖慢临时链接打开。",
          en: "Every site now has its own analytics page with live traffic trends, referrers, paths, country and regional breakdowns, and a visual map. Metrics are reported asynchronously at the edge, so shared links stay fast.",
        },
        note: {
          zh: "不是监控你，是监控你的作品有没有被看。",
          en: "We're not watching you. We're checking whether anyone is watching your work.",
        },
      },
      {
        tag: "Privacy",
        title: {
          zh: "加密真实访问日志",
          en: "Encrypted access logs",
        },
        desc: {
          zh: "完整访问日志会加密写入私有对象存储，授权成员可以在分析页随时回看时间、IP、地区、路径、来源和设备信息。聚合数据每 5 分钟批量落 MySQL，原始日志不压数据库。",
          en: "Complete access logs are encrypted in private object storage. Authorized members can review timestamps, IPs, regions, paths, referrers, and device details from the analytics page. Aggregates are written to MySQL every five minutes, while raw logs stay out of the database.",
        },
        note: {
          zh: "能查，但不裸奔。",
          en: "Searchable, but never exposed.",
        },
      },
      {
        tag: "Infra",
        title: {
          zh: "增长数据后台化",
          en: "Growth metrics moved backstage",
        },
        desc: {
          zh: "Powered by Demox 点击仍会统计，但只作为后台增长指标，不再出现在普通用户的站点卡片或公开展示里。",
          en: "Clicks on Powered by Demox are still counted as internal growth metrics, but no longer appear on site cards or in public-facing views.",
        },
        note: {
          zh: "数据库：谢谢你终于放过我。",
          en: "The database says: thanks for finally leaving me alone.",
        },
      },
    ],
  },
  {
    version: "current",
    name: {
      zh: "边缘门禁 (Edge Gate)",
      en: "Edge Gate",
    },
    date: "2026-06-15",
    dateNote: {
      zh: "(门口有保安了)",
      en: "(there is finally a guard at the door)",
    },
    features: [
      {
        tag: "Security",
        title: {
          zh: "私有站点",
          en: "Private sites",
        },
        desc: {
          zh: "站点现在可以切换公开/私有。私有站点会在边缘层先拦截访问，未登录跳转 Demox 登录，登录后仍无权限则直接返回 Access denied。",
          en: "Sites can now be public or private. Private-site access is intercepted at the edge: signed-out visitors go to Demox sign-in, while signed-in users without permission receive Access denied.",
        },
        note: {
          zh: "不是所有 URL 都该裸奔。",
          en: "Not every URL should run around in public.",
        },
      },
      {
        tag: "UX",
        title: {
          zh: "登录后跳回原站点",
          en: "Return to the original site after sign-in",
        },
        desc: {
          zh: "私有站点的登录流程会记住原访问地址，邮箱验证码和 GitHub 登录完成后都会自动跳回。",
          en: "The private-site sign-in flow remembers the original URL and returns you there after email-code or GitHub authentication.",
        },
        note: {
          zh: "门卫终于知道你是来找哪一户的。",
          en: "The doorman finally knows which door you came for.",
        },
      },
    ],
  },
  {
    version: "v0.9.0",
    name: {
      zh: "海纳百川 (The Great Migration)",
      en: "The Great Migration",
    },
    date: "2026-06-13",
    dateNote: {
      zh: "(吃自己的狗粮，真香)",
      en: "(dogfooding tastes surprisingly good)",
    },
    features: [
      {
        tag: "Feature",
        title: {
          zh: "多云存储桶注册制",
          en: "Registered multi-cloud buckets",
        },
        desc: {
          zh: "存储桶改为注册制，抽象出统一的存储层，密钥加密入库。多云时代的第一块砖，先把地基打牢。",
          en: "Storage buckets now use a registration model behind a unified storage layer, with credentials encrypted at rest. The first brick of our multi-cloud foundation is in place.",
        },
        note: {
          zh: "目前还是单云，但架子已经搭好，吹牛不犯法。",
          en: "Still one cloud for now, but the scaffolding is ready. Aspirations are free.",
        },
      },
      {
        tag: "Infra",
        title: {
          zh: "主站自托管",
          en: "The main site hosts itself",
        },
        desc: {
          zh: "本站不再走 GitHub Actions 传 COS，而是把自己当成一个普通用户站点，用 demox 部署 demox。",
          en: "The main site no longer ships to COS directly from GitHub Actions. It now behaves like any other user site: Demox deploys Demox.",
        },
        note: {
          zh: "套娃部署成功，删桶根那次白屏的眼泪我们自己擦干了。",
          en: "Recursive deployment unlocked. We wiped away our own tears from that time the bucket root disappeared.",
        },
      },
      {
        tag: "CI",
        title: {
          zh: "一键自动发布",
          en: "One-push automated releases",
        },
        desc: {
          zh: "push 到 master 自动构建打包并发布到边缘网络，纯 curl 最小依赖。顺手把路由从 # 哈希切到了真·浏览器路由。",
          en: "A push to master now builds, packages, and publishes to the edge automatically with minimal curl-based dependencies. Routes also moved from hash URLs to real browser paths.",
        },
        note: {
          zh: "地址栏里那个碍眼的 # 终于没了。",
          en: "That annoying # has finally left the address bar.",
        },
      },
      {
        tag: "Fix",
        title: {
          zh: "DNS 与证书急救",
          en: "DNS and certificate rescue",
        },
        desc: {
          zh: "修复了首页打开慢十秒和 HTTPS 证书过期的连环坑，根因是 DNS 绕路。已把解析迁回，证书重新签发。",
          en: "Fixed the ten-second homepage delay and expired HTTPS certificate. DNS was taking the scenic route, so we moved resolution back and reissued the certificate.",
        },
        note: {
          zh: "证书续期失败这种事，总在你睡着时发生。",
          en: "Certificate renewals only fail while you are asleep.",
        },
      },
    ],
  },
  {
    version: "v0.8.0",
    name: {
      zh: "认证觉醒 (The Awakening)",
      en: "The Awakening",
    },
    date: "2026-06-12",
    dateNote: {
      zh: "(终于有人管门了)",
      en: "(someone is finally minding the door)",
    },
    features: [
      {
        tag: "Feature",
        title: {
          zh: "GitHub 一键登录",
          en: "One-click GitHub sign-in",
        },
        desc: {
          zh: "接入 GitHub OAuth，点一下就能登录或绑定账号。无主账号还能选择新建还是关联已有，不再偷偷帮你合并。",
          en: "GitHub OAuth now supports one-click sign-in and account linking. For unclaimed identities, you choose whether to create a new account or link an existing one; no more silent merges.",
        },
        note: {
          zh: "毕竟你的 star 数就是你的尊严。",
          en: "Your star count is your dignity, after all.",
        },
      },
      {
        tag: "Refactor",
        title: {
          zh: "控制台大改造",
          en: "Console overhaul",
        },
        desc: {
          zh: "登录后的控制台从顶栏导航重构为独立的侧边栏 + 嵌套路由，营销页和控制台彻底分家。",
          en: "The signed-in console moved from top navigation to a dedicated sidebar with nested routes, finally separating the product console from the marketing site.",
        },
        note: {
          zh: "终于不再像两个妈生的了。",
          en: "They finally look like they belong to the same family.",
        },
      },
      {
        tag: "Feature",
        title: {
          zh: "自定义子域名",
          en: "Custom subdomains",
        },
        desc: {
          zh: "每个站点除了默认域名，还能挑一个好记的官方域名前缀，例如 {label}.demox.site。",
          en: "Each site can choose a memorable official subdomain in addition to its default domain, such as {label}.demox.site.",
        },
        note: {
          zh: "抢一个好听的名字，手慢无。",
          en: "Claim a good name before someone else does.",
        },
      },
      {
        tag: "Feature",
        title: {
          zh: "MCP 部署",
          en: "MCP deployments",
        },
        desc: {
          zh: "提供 MCP server，让 AI 助手直接帮你部署站点。你动嘴，它动手。",
          en: "An MCP server lets AI assistants deploy sites for you. You say it; they ship it.",
        },
        note: {
          zh: "未来你可能连拖拽都懒得拖了。",
          en: "Soon even drag-and-drop may feel like too much work.",
        },
      },
      {
        tag: "Style",
        title: {
          zh: "主题三态切换",
          en: "Three-way theme switching",
        },
        desc: {
          zh: "新增 跟随系统 / 浅色 / 深色 三态主题，浅色模式由深色镜像反转而来，颜色体系全部走 CSS 变量。",
          en: "Added system, light, and dark theme modes. Light mode mirrors the dark palette, with the entire color system driven by CSS variables.",
        },
        note: {
          zh: "白天党终于不用被亮瞎了。",
          en: "Daylight users can finally keep their retinas.",
        },
      },
    ],
  },
  {
    version: "v0.7.7",
    name: {
      zh: "井井有条 (Orderliness)",
      en: "Orderliness",
    },
    date: "2025-12-29",
    dateNote: {
      zh: "(强迫症狂喜)",
      en: "(a neat freak's dream)",
    },
    features: [
      {
        tag: "Feature",
        title: {
          zh: "资源标签管理",
          en: "Resource tags",
        },
        desc: {
          zh: "增加了资源标签管理。终于不用在一堆乱七八糟的资源里大海捞针了，现在你可以优雅地给它们打上标签。",
          en: "Added resource tag management. No more searching through a pile of mystery resources; label them like a civilized person.",
        },
        note: {
          zh: "整理使人快乐，虽然通常只能维持一天。",
          en: "Tidying sparks joy, even if it only lasts a day.",
        },
      },
    ],
  },
  {
    version: "v0.7.0",
    name: {
      zh: "名正言顺 (The Identity)",
      en: "The Identity",
    },
    date: "2025-12-26",
    dateNote: {
      zh: "(有了名字就有了灵魂)",
      en: "(a name gives it a soul)",
    },
    features: [
      {
        tag: "Brand",
        title: {
          zh: "Demox & Logo",
          en: "Demox & Logo",
        },
        desc: {
          zh: "我们产品名定下来了 Demox，还有 Logo。这些真的很重要。",
          en: "We settled on the name Demox and got a logo. These things really do matter.",
        },
        note: {
          zh: "感觉身价倍增。",
          en: "Our valuation feels higher already.",
        },
      },
    ],
  },
  {
    version: "v0.6.0",
    name: {
      zh: "流量密码 (The Traffic Hack)",
      en: "The Traffic Hack",
    },
    date: "2025-12-26",
    dateNote: {
      zh: "(假装我们在做增长)",
      en: "(pretending we know growth)",
    },
    features: [
      {
        tag: "SEO",
        title: {
          zh: "搜索引擎优化",
          en: "Search engine optimization",
        },
        desc: {
          zh: "终于想起来做 SEO 了。Meta 标签、Sitemap、Open Graph 全套安排。虽然大概率还是搜不到，但至少我们给爬虫留了门。",
          en: "We finally remembered SEO: meta tags, sitemap, Open Graph, the whole set. Search engines may still ignore us, but at least the crawlers have a door.",
        },
        note: {
          zh: "只要关键词够多，我就能上首页（做梦）。",
          en: "Enough keywords will put us on page one. In our dreams.",
        },
      },
    ],
  },
  {
    version: "v0.5.0",
    name: {
      zh: "认清现实 (The Reality Check)",
      en: "The Reality Check",
    },
    date: "2025-12-26",
    dateNote: {
      zh: "(版本号倒退是种艺术)",
      en: "(version regression is an art form)",
    },
    features: [
      {
        tag: "Refactor",
        title: {
          zh: "Layout 大装修",
          en: "Layout renovation",
        },
        desc: {
          zh: "前端重构了 layout 部分。之前的代码像意大利面，现在的像千层面——至少有层了。",
          en: "Refactored the frontend layout. It used to be spaghetti; now it is lasagna. At least it has layers.",
        },
        note: {
          zh: "为了看起来更专业，我们把能居中的都居中了。",
          en: "To look more professional, we centered everything that could be centered.",
        },
      },
      {
        tag: "Fix",
        title: {
          zh: "黄油手补丁",
          en: "Butterfingers patch",
        },
        desc: {
          zh: "修复了不能拖拽上传的问题。现在你可以优雅地把文件甩进窗口，而不是像个原始人一样点击‘选择文件’。",
          en: "Fixed broken drag-and-drop uploads. You can now toss files into the window instead of clicking Choose file like a caveman.",
        },
      },
      {
        tag: "Security",
        title: {
          zh: "门卫大爷上岗",
          en: "The bouncer clocks in",
        },
        desc: {
          zh: "增加了鉴权与角色校验。现在不是谁都能进来了，虽然我们要防的人可能根本不存在。",
          en: "Added authentication and role checks. Not everyone can walk in anymore, even if the people we are guarding against may not exist.",
        },
        note: {
          zh: "Role: 'God' 模式开发中。",
          en: "Role: 'God' mode is under construction.",
        },
      },
      {
        tag: "Fix",
        title: {
          zh: "导航栏精神分裂症",
          en: "Navigation identity crisis",
        },
        desc: {
          zh: "修复了“首页”和“控制台”导航栏长得像两个妈生的 Bug。",
          en: "Fixed the bug where the Home and Console navigation bars looked like they came from different products.",
        },
        note: {
          zh: "原因：某位热心网友指出这看起来很“割裂”，为了不被设计师打死，我们决定改了。",
          en: "A helpful stranger called the design disconnected, so we fixed it before a designer could come after us.",
        },
      },
      {
        tag: "Optim",
        title: {
          zh: "上传宽容度",
          en: "More forgiving uploads",
        },
        desc: {
          zh: "正在教服务器学会翻箱倒柜。以后不管你把 index.html 藏在哪个子文件夹里，我们都能把它揪出来。",
          en: "We are teaching the server to rummage through folders. Soon, wherever you hide index.html, we will find it.",
        },
      },
    ],
  },
  {
    version: "v0.3.0",
    name: {
      zh: "秩序重建 (Order Restored)",
      en: "Order Restored",
    },
    date: "2025-12-25",
    dateNote: {
      zh: "(圣诞节的礼物是代码整洁)",
      en: "(the Christmas gift is clean code)",
    },
    features: [
      {
        tag: "Optim",
        title: {
          zh: "ID 系统大扫除",
          en: "ID system cleanup",
        },
        desc: {
          zh: "优化文件名处理、网站 ID 生成和删除逻辑。之前的 ID 像是乱码生成器，现在终于有了点人类逻辑。",
          en: "Improved filename handling, site ID generation, and deletion logic. IDs used to look like random noise; now they almost make human sense.",
        },
        note: {
          zh: "删除逻辑也修复了，现在“删除”真的意味着“消失”。",
          en: "Deletion is fixed too. Delete now actually means disappear.",
        },
      },
    ],
  },
  {
    version: "v0.2.0",
    name: {
      zh: "独立日 (Independence Day)",
      en: "Independence Day",
    },
    date: "2025-12-25",
    dateNote: {
      zh: "(剪断脐带)",
      en: "(cutting the cord)",
    },
    features: [
      {
        tag: "Refactor",
        title: {
          zh: "告别 Weda",
          en: "Farewell, Weda",
        },
        desc: {
          zh: "重构网站部署逻辑，移除 Weda 依赖并优化云。我们终于不再依赖外部输血，学会了独立呼吸。",
          en: "Reworked site deployment, removed the Weda dependency, and optimized cloud resources. We finally learned to breathe on our own.",
        },
        note: {
          zh: "云端资源已优化，服务器松了一口气。",
          en: "Cloud resources are optimized. The server can breathe again.",
        },
      },
    ],
  },
  {
    version: "v0.1.0",
    name: {
      zh: "创世纪 (Genesis)",
      en: "Genesis",
    },
    date: "2025-12-25",
    dateNote: {
      zh: "(圣诞节还在写代码，你是魔鬼吗？)",
      en: "(coding on Christmas, you monster)",
    },
    features: [
      {
        tag: "Feature",
        title: {
          zh: "拖拽部署",
          en: "Drag-and-drop deployment",
        },
        desc: {
          zh: "支持把 .zip 甩到脸上。因为我们知道你懒得输 scp 命令。",
          en: "Throw a .zip at us and we will deploy it, because we know you cannot be bothered to type an scp command.",
        },
        note: {
          zh: "Dev Note: 实际上只支持根目录 index.html，别试探我的底线。",
          en: "Dev note: only a root-level index.html is supported. Do not test our patience.",
        },
      },
      {
        tag: "Style",
        title: {
          zh: "暗黑模式",
          en: "Dark mode",
        },
        desc: {
          zh: "默认全黑。为了保护你的视网膜，也为了省点电费。",
          en: "Black by default, to protect your retinas and shave a little off the power bill.",
        },
      },
    ],
  },
];

/** Pick the text for the current UI language from a { zh, en } pair (plain strings pass through). */
export const pickLang = (text, language) => {
  if (text == null || typeof text === "string") return text;
  return text[language] ?? text.zh;
};

export const categoryOf = (tag) => TAG_CATEGORY[tag] || "feature";
