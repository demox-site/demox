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
    id: "mcp",
    component: Docs
  },
  {
    id: "docs",
    component: Docs
  },
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
    id: "*",
    component: NotFoundPage
  }
];
