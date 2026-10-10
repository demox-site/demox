import assert from "node:assert/strict";
import test from "node:test";
import { isSafeLoginNext, buildLoginRedirect, readLoginNext } from "./login-next.js";

test("isSafeLoginNext allows relative app paths only", () => {
  assert.equal(isSafeLoginNext("/console/projects"), true);
  assert.equal(isSafeLoginNext("/console/projects?x=1"), true);
  assert.equal(isSafeLoginNext("/"), true);
  assert.equal(isSafeLoginNext("//evil.com"), false);
  assert.equal(isSafeLoginNext("https://evil.com"), false);
  assert.equal(isSafeLoginNext("/\\evil"), false);
  assert.equal(isSafeLoginNext(""), false);
  assert.equal(isSafeLoginNext(null), false);
});

test("buildLoginRedirect encodes next or returns home", () => {
  assert.equal(buildLoginRedirect("/"), "/");
  assert.equal(buildLoginRedirect("/console/tokens"), "/?next=%2Fconsole%2Ftokens");
  assert.equal(buildLoginRedirect("//evil"), "/");
});

test("readLoginNext rejects open redirects", () => {
  assert.equal(readLoginNext("?next=%2Fconsole%2Fprojects"), "/console/projects");
  assert.equal(readLoginNext("next=%2Fconsole%2Fprojects"), "/console/projects");
  assert.equal(readLoginNext("?next=https%3A%2F%2Fevil.com"), null);
  assert.equal(readLoginNext("?next=%2F%2Fevil.com"), null);
});
