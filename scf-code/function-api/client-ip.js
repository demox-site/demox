'use strict';

/**
 * X-Forwarded-For 最右一段：离我们最近的代理追加的；左边的都可被客户端伪造。
 * Web 入口（web-server.js clientIpFrom）和 Event 入口（service.js 没有 requestContext.sourceIp 时）共用。
 * 注意：如果以后 api.demox.site 放到 EdgeOne 后面，最右段会变成 EdgeOne 节点 IP，必须改读 EdgeOne 的客户端 IP 头。
 */
function rightmostForwardedFor(value) {
  const parts = String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

module.exports = { rightmostForwardedFor };
