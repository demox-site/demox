import HOME from "../pages/home.jsx";
import CloudHostLanding from "../pages";
import NotFoundPage from "../pages/404";
import MemberPrice from "../pages/memberPrice";
import AdminDashboard from "../pages/AdminDashboard";
import LogPage from "../pages/log";
import TermsPage from "../pages/terms";
import PrivacyPage from "../pages/privacy";
import LayoutDemo from "../pages/LayoutDemo";

export const routers = [
  {
    id: "index",
    component: CloudHostLanding,
    isHome: true
  },
  {
    id: "admin",
    component: AdminDashboard
  },
  {
    id: "pricing",
    component: MemberPrice
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
    id: "home",
    component: HOME
  },
  {
    id: "*",
    component: NotFoundPage
  }
];
