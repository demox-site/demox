'use strict';

/**
 * 测试用日志泄漏守卫：在被测函数 require 之前装上，记录每一条 console 输出
 * （记录的是经过函数自身脱敏之后、真正要写进 SCF 日志的内容）。
 * 测试文件最后调用 assertNoLeaks()：只要有一条日志里出现 token / JWT / PAT /
 * OAuth code / 邮箱，就失败并指出是哪一条。
 */

const util = require('node:util');

const LEAK_PATTERNS = [
  ['jwt', /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['bearer', /\bBearer\s+(?!\[)[A-Za-z0-9._~+/-]{8,}/i],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['opaque-token', /\b[A-Za-z0-9]{40,}\b/],
  ['token-field', /(?:access_?token|refresh_?token|client_?secret|code_?verifier|password)["']?\s*[:=]\s*["']?(?!\[)[^"'&\s,;})\]]{4,}/i],
  ['verification-code', /验证码[^0-9\n]{0,40}\d{4,8}/]
];

function findLeaks(text) {
  return LEAK_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function installLogLeakGuard({ target = console, passthrough = false } = {}) {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    target[method] = function recordingConsoleMethod(...args) {
      lines.push({ method, text: util.format(...args) });
      if (passthrough) return original.apply(target, args);
      return undefined;
    };
  }
  return {
    lines,
    leaks() {
      return lines
        .map((line) => ({ ...line, kinds: findLeaks(line.text) }))
        .filter((line) => line.kinds.length > 0);
    },
    assertNoLeaks() {
      const found = this.leaks();
      if (found.length) {
        const mask = (text) => LEAK_PATTERNS.reduce((out, [name, pattern]) => out.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`), `<${name}>`), text);
        const sample = found.slice(0, 5).map((line) => `console.${line.method} [${line.kinds.join(',')}]: ${mask(line.text).slice(0, 200)}`).join('\n');
        throw new Error(`${found.length} 条日志带出了 token 或邮箱:\n${sample}`);
      }
      return lines.length;
    }
  };
}

module.exports = { installLogLeakGuard, findLeaks, LEAK_PATTERNS };
