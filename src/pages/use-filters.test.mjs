import test from "node:test";
import assert from "node:assert/strict";

import { extractProjectTags, websiteMatchesProject, websiteMatchesSearch } from "./use-filters.js";

test("extractProjectTags only returns tags from the selected project", () => {
  const websites = [
    { projectId: "project-a", tags: ["shared", "alpha"] },
    { projectId: "project-b", tags: ["shared", "beta"] },
    { projectId: "project-b", tags: ["gamma", "beta"] }
  ];

  assert.deepEqual(extractProjectTags(websites, "project-b"), [
    "beta",
    "gamma",
    "shared"
  ]);
});

test("project matching supports public and internal project ids", () => {
  const website = {
    projectId: "public-project-id",
    projectInternalId: "42",
    tags: ["current-project"]
  };

  assert.equal(websiteMatchesProject(website, "public-project-id"), true);
  assert.equal(websiteMatchesProject(website, 42), true);
  assert.equal(websiteMatchesProject(website, "another-project"), false);
  assert.equal(websiteMatchesProject({}, "public-project-id"), false);
  assert.deepEqual(extractProjectTags([website], "another-project"), []);
});

test("websiteMatchesSearch looks at name, id, tags, and hosts", () => {
  const website = {
    name: "客户评审稿",
    fileName: "review.zip",
    websiteId: "AB12CD34",
    tags: ["client", "demo"],
    customHosts: ["acme.demox.site"],
    subdomain: "acme"
  };

  assert.equal(websiteMatchesSearch(website, ""), true);
  assert.equal(websiteMatchesSearch(website, "  评审  "), true);
  assert.equal(websiteMatchesSearch(website, "ACME"), true);
  assert.equal(websiteMatchesSearch(website, "client"), true);
  assert.equal(websiteMatchesSearch(website, "ab12cd34"), true);
  assert.equal(websiteMatchesSearch(website, "missing"), false);
});
