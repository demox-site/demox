import { lazy, type ComponentType } from "react";
import CloudHostLanding from "../pages";
import { INTENT_LANDINGS } from "../content/intent-landings.mjs";

// 首页留在主包里，标题和按钮可以跟入口脚本一起出来。
// 其余页面按路由再拉，避免打开首页时先下载控制台、文档和全部落地页。
function loadPage(
  importer: () => Promise<Record<string, ComponentType<any> | undefined>>,
  exportName = "default"
) {
  return lazy(() =>
    importer().then((mod) => ({
      default: (mod[exportName] ?? mod.default) as ComponentType<any>
    }))
  );
}

const MemberPrice = loadPage(() => import("../pages/memberPrice"));
const Docs = loadPage(() => import("../pages/Docs"), "Docs");
const ContentScanPage = loadPage(() => import("../pages/ContentScanPage"));
const AiStaticSiteGuide = loadPage(() => import("../pages/AiStaticSiteGuide"));
const WhenToUseDemox = loadPage(() => import("../pages/WhenToUseDemox"));
const DeployTroubleshooting = loadPage(() => import("../pages/DeployTroubleshooting"));
const HowDemoxHostsItself = loadPage(() => import("../pages/HowDemoxHostsItself"));
const IntentLanding = loadPage(() => import("../pages/IntentLanding"));
const LayoutDemo = loadPage(() => import("../pages/LayoutDemo"));
const TermsPage = loadPage(() => import("../pages/terms"));
const PrivacyPage = loadPage(() => import("../pages/privacy"));
const LogPage = loadPage(() => import("../pages/log"));
const MCPLogin = loadPage(() => import("../pages/MCPLogin"), "MCPLogin");
const MCPAuthorize = loadPage(() => import("../pages/MCPAuthorize"), "MCPAuthorize");
const GithubCallback = loadPage(() => import("../pages/GithubCallback"));
const GithubLink = loadPage(() => import("../pages/GithubLink"));
const FeishuCallback = loadPage(() => import("../pages/FeishuCallback"));
const FeishuLink = loadPage(() => import("../pages/FeishuLink"));
const SiteAuth = loadPage(() => import("../pages/SiteAuth"));
const NotFoundPage = loadPage(() => import("../pages/404"));

export const routers = [
  {
    id: "index",
    component: CloudHostLanding,
    isHome: true
  },
  {
    id: "pricing",
    component: MemberPrice
  },
  {
    id: "doc",
    component: Docs
  },
  {
    id: "content-scan",
    component: ContentScanPage
  },
  {
    id: "ai-static-site-deployment",
    component: AiStaticSiteGuide
  },
  {
    id: "when-to-use-demox",
    component: WhenToUseDemox
  },
  {
    id: "deploy-troubleshooting",
    component: DeployTroubleshooting
  },
  {
    id: "how-demox-hosts-itself",
    component: HowDemoxHostsItself
  },
  ...INTENT_LANDINGS.map((page) => ({
    id: page.id,
    component: IntentLanding
  })),
  {
    id: "layout-demo",
    component: LayoutDemo
  },
  {
    id: "terms",
    component: TermsPage
  },
  {
    id: "privacy",
    component: PrivacyPage
  },
  {
    id: "log",
    component: LogPage
  },
  {
    id: "mcp-login",
    component: MCPLogin
  },
  {
    id: "mcp-authorize",
    component: MCPAuthorize
  },
  {
    id: "github-callback",
    component: GithubCallback
  },
  {
    id: "github-link",
    component: GithubLink
  },
  {
    id: "feishu-callback",
    component: FeishuCallback
  },
  {
    id: "feishu-link",
    component: FeishuLink
  },
  {
    id: "site-auth",
    component: SiteAuth
  },
  {
    id: "*",
    component: NotFoundPage
  }
];
