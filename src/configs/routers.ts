import HOME from "../pages/home.jsx";
import CloudHostLanding from "../pages";
import NotFoundPage from "../pages/404";
import MemberPrice from "../pages/memberPrice";
import LogPage from "../pages/log";

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
