import CloudHostLanding from "../pages";
import NotFoundPage from "../pages/404";
import MemberPrice from "../pages/memberPrice";
import LogPage from "../pages/log";
import TermsPage from "../pages/terms";
import PrivacyPage from "../pages/privacy";
import LayoutDemo from "../pages/LayoutDemo";
import { MCPLogin } from "../pages/MCPLogin";
import { MCPAuthorize } from "../pages/MCPAuthorize";
import { Docs } from "../pages/Docs";
import { GithubCallback } from "../pages/GithubCallback";
import { GithubLink } from "../pages/GithubLink";
import { FeishuCallback } from "../pages/FeishuCallback";
import { FeishuLink } from "../pages/FeishuLink";
import { SiteAuth } from "../pages/SiteAuth";
import AiStaticSiteGuide from "../pages/AiStaticSiteGuide";
import ContentScanPage from "../pages/ContentScanPage";
import WhenToUseDemox from "../pages/WhenToUseDemox";
import DeployTroubleshooting from "../pages/DeployTroubleshooting";
import HowDemoxHostsItself from "../pages/HowDemoxHostsItself";
import IntentLanding from "../pages/IntentLanding";
import { INTENT_LANDINGS } from "../content/intent-landings.mjs";

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
