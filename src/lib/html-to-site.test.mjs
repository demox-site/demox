import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import {
  buildHtmlSiteZipFile,
  isSupportedHtml
} from "./html-to-site.js";
import { validateStaticZipFile } from "./static-zip-validator.js";

test("recognizes only .html and .htm files, case-insensitively", () => {
  assert.equal(isSupportedHtml(new File([""], "page.html")), true);
  assert.equal(isSupportedHtml(new File([""], "PAGE.HTM")), true);
  assert.equal(isSupportedHtml(new File([""], "page.html.zip")), false);
  assert.equal(isSupportedHtml(new File([""], "page.xhtml")), false);
});

test("packages a single HTML file as root index.html", async () => {
  const html = "<!doctype html><title>Single page</title><h1>Hello</h1>";
  const source = new File([html], "Launch Page.html", { type: "text/html" });

  const { zipFile, title } = await buildHtmlSiteZipFile({ file: source });
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
  const files = Object.values(zip.files).filter((entry) => !entry.dir);

  assert.equal(title, "Launch Page");
  assert.equal(zipFile.name, "launch-page.zip");
  assert.deepEqual(files.map((entry) => entry.name), ["index.html"]);
  assert.equal(await zip.file("index.html").async("string"), html);
  assert.deepEqual(
    await validateStaticZipFile(await zipFile.arrayBuffer(), "en"),
    { valid: true }
  );
});

test("keeps the existing static-site guard for missing local assets", async () => {
  const source = new File(
    ['<!doctype html><link rel="stylesheet" href="./app.css"><h1>Hello</h1>'],
    "page.html",
    { type: "text/html" }
  );

  const { zipFile } = await buildHtmlSiteZipFile({ file: source });
  const result = await validateStaticZipFile(await zipFile.arrayBuffer(), "en");

  assert.equal(result.valid, false);
  assert.match(result.message, /missing JS\/CSS files/i);
});
