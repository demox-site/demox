import assert from "node:assert/strict";
import test from "node:test";
import { SEO_SHELL_HOLD_MS, seoShellHoldMs } from "./seo-shell-hold.mjs";

test("homepage SEO shell holds for 3 seconds", () => {
  assert.equal(SEO_SHELL_HOLD_MS, 3000);
  for (const path of ["/", "/index", "/index/", "/zh", "/zh/", ""]) {
    assert.equal(seoShellHoldMs(path), 3000, path);
  }
});

test("other routes do not hold the SEO shell", () => {
  for (const path of ["/pricing", "/zh/pricing", "/doc", "/console/projects", "/when-to-use-demox", "/zh/free-static-site-hosting"]) {
    assert.equal(seoShellHoldMs(path), 0, path);
  }
});
