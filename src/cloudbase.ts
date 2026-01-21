import cloudbase from "@cloudbase/js-sdk";
import env from "./configs/env";

const app = cloudbase.init({
  env: env.env,
  region: "ap-chengdu",
  timeout: 600000
});

const auth = app.auth();
const db = app.database();

export { app, auth, db };
