import test from "node:test";
import assert from "node:assert/strict";
import { throttleWaitParts, throttleMessage } from "./login-throttle.js";

test("wait parts round up to minutes, seconds under a minute", () => {
  assert.deepEqual(throttleWaitParts(60_000), [1, "m"]);
  assert.deepEqual(throttleWaitParts(61_000), [2, "m"]);
  assert.deepEqual(throttleWaitParts(15 * 60_000), [15, "m"]);
  assert.deepEqual(throttleWaitParts(59_001), [1, "m"]);
  assert.deepEqual(throttleWaitParts(42_300), [43, "s"]);
  assert.deepEqual(throttleWaitParts(0), [1, "s"]);
});

test("messages state how long to wait", () => {
  assert.equal(throttleMessage(120_000), "登录尝试次数过多，请 2 分钟后再试。");
  assert.equal(throttleMessage(30_000), "登录尝试次数过多，请 30 秒后再试。");
  assert.equal(throttleMessage(60_000, "en"), "Too many sign-in attempts. Try again in 1 minute.");
  assert.equal(throttleMessage(240_000, "en"), "Too many sign-in attempts. Try again in 4 minutes.");
});
