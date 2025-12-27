import cloudbase from "@cloudbase/js-sdk";
import env from "./configs/env";

const app = cloudbase.init({
  env: env.env,
  region: "ap-shanghai",
  timeout: 900000
});

const auth = app.auth();
const db = app.database();

export { app, auth, db };
