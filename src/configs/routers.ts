import HOME from "../pages/home.jsx";
import CloudHostLanding from "../pages/CloudHostLanding";

export const routers = [
  {
    id: "index",
    component: CloudHostLanding,
    isHome: true
  },
  {
    id: "home",
    component: HOME
  }
];
