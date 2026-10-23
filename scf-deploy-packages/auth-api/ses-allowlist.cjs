'use strict';

/** 平台 SES 只允许这两个发信域、这两个已审核模板。其它组合在调用 SES 之前拒绝。 */
const ALLOWED_FROM_DOMAINS = Object.freeze(['mail.demox.site', 'mail.aigc.sx.cn']);
const ALLOWED_TEMPLATE_IDS = Object.freeze([137482, 226012]);

function parseSesFromAddress(from) {
  const text = String(from || '').trim();
  const bracket = text.match(/^(.*)<([^<>]+)>$/);
  const address = (bracket ? bracket[2] : text).trim();
  if (bracket && /[<>@]/.test(bracket[1])) return '';
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) return '';
  return address.toLowerCase();
}

function sesFromDomain(from) {
  const address = parseSesFromAddress(from);
  const at = address.lastIndexOf('@');
  return at > 0 ? address.slice(at + 1) : '';
}

function assertPlatformSesSend({ from, templateId } = {}) {
  const domain = sesFromDomain(from);
  const id = Number(templateId);
  const domainOk = ALLOWED_FROM_DOMAINS.includes(domain);
  const templateOk = Number.isInteger(id) && ALLOWED_TEMPLATE_IDS.includes(id);
  if (!domainOk || !templateOk) {
    const error = new Error('发信地址或模板不在允许列表');
    error.code = 'SES_SEND_REFUSED';
    throw error;
  }
  return { domain, templateId: id };
}

module.exports = {
  ALLOWED_FROM_DOMAINS,
  ALLOWED_TEMPLATE_IDS,
  parseSesFromAddress,
  sesFromDomain,
  assertPlatformSesSend
};
