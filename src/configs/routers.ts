import HOME from "../pages/home.jsx";
import CloudHostLanding from "../pages";
import NotFoundPage from "../pages/404";
import MemberPrice from "../pages/memberPrice";
import AdminDashboard from "../pages/AdminDashboard";

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
    id: "home",
    component: HOME
  },
  {
    id: "*",
    component: NotFoundPage
  }
];
