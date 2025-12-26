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
          title: isZh ? '首页' : 'Home',
          description: undefined // Use default
        };
      case 'pricing':
        return {
          title: isZh ? '会员价格' : 'Pricing',
          description: isZh ? 'Demox 会员订阅方案' : 'Demox Membership Pricing'
        };
      case 'terms':
        return {
          title: isZh ? '服务条款' : 'Terms of Service',
        };
      case 'privacy':
        return {
          title: isZh ? '隐私政策' : 'Privacy Policy',
        };
      case 'log':
        return {
          title: isZh ? '更新日志' : 'Changelog',
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
