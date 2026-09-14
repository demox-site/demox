import * as React from "react";
import { Seo } from "../Seo";
import { useLanguage } from "@/hooks/use-language";

/**
 * PageWrapper
 * 负责渲染路由页面组件，剔除 Weda 依赖，直接渲染传入的 React 组件
 */
export function PageWrapper({
  id,
  Page,
  ...props
}: {
  id: string;
  Page: React.FunctionComponent<any>;
}) {
  const { language } = useLanguage();
  const isZh = language === 'zh';

  const getPageMeta = (pageId: string) => {
    switch (pageId) {
      case 'index':
      case 'home':
        return {
          title: undefined,
          description: undefined // Use default
        };
      case 'pricing':
        return {
          title: isZh ? '会员价格' : 'Pricing',
          description: isZh ? 'Demox 会员订阅方案' : 'Demox Membership Pricing'
        };
      case 'ai-static-site-deployment':
        return {
          title: isZh ? 'AI 生成网页如何快速发布成静态网站' : 'How to publish an AI-generated static website',
          description: isZh
            ? '从单个 HTML、ZIP 或前端构建产物出发，用网页、CLI、MCP 或 AI 助手发布静态网站并获得 HTTPS 链接。'
            : 'Publish an AI-generated HTML page, ZIP, or frontend build as a static website through the web, CLI, MCP, or an AI assistant.',
        };
      case 'when-to-use-demox':
        return {
          title: isZh ? '什么时候该用 Demox' : 'When to use Demox',
          description: isZh
            ? '对照静态页面、Node handler、Express 和独立后端，判断项目是否适合 Demox。'
            : 'Compare static pages, Node handlers, Express, and separate backends to see whether Demox is a fit.',
        };
      case 'deploy-troubleshooting':
        return {
          title: isZh ? 'Demox 发布失败排错' : 'Demox deploy troubleshooting',
          description: isZh
            ? '对照 MISSING_ENTRYPOINT、CONTENT_BLOCKED、INVALID_STATIC_SITE 和 Access denied 等原文处理发布失败。'
            : 'Match MISSING_ENTRYPOINT, CONTENT_BLOCKED, INVALID_STATIC_SITE, and Access denied to the verified fix.',
        };
      case 'how-demox-hosts-itself':
        return {
          title: isZh ? 'Demox 怎样用自己部署自己' : 'How Demox hosts itself',
          description: isZh
            ? '主站用 demox deploy 发页面，用 demox functions push 发 Node 后端。这是仓库记录的现行发布方式。'
            : 'The main site uses demox deploy for pages and demox functions push for Node backends. This is the current repository release path.',
        };
      case 'terms':
        return {
          title: isZh ? '服务条款' : 'Terms of Service',
          description: isZh ? 'Demox 服务条款与用户责任说明' : 'Demox terms of service and user responsibilities',
        };
      case 'privacy':
        return {
          title: isZh ? '隐私政策' : 'Privacy Policy',
          description: isZh ? 'Demox 隐私政策与数据处理说明' : 'Demox privacy policy and data handling practices',
        };
      case 'content-scan':
        return {
          title: isZh ? '屏蔽词表' : 'Blocklist',
          description: isZh
            ? '查看 Demox 部署前本地规则使用的全部屏蔽词，以及公开查询接口。'
            : 'The complete Demox local blocklist and the public list API.',
        };
      case 'log':
        return {
          title: isZh ? '更新日志' : 'Changelog',
          description: isZh ? 'Demox 产品功能与基础设施更新记录' : 'Demox product and infrastructure updates',
        };
      case 'site-auth':
        return {
          title: isZh ? '私有站点登录' : 'Private Site Sign-in',
        };
      case 'admin':
        return {
          title: isZh ? '管理控制台' : 'Admin Dashboard',
        };
      default:
        return {
          title: undefined,
          description: undefined
        };
    }
  };

  const meta = getPageMeta(id);

  return (
    <>
      <Seo title={meta.title} description={meta.description} />
      <Page {...props} />
    </>
  );
}
