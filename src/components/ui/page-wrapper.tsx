import * as React from "react";

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
  return <Page {...props} />;
}
