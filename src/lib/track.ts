/**
 * 产品漏斗埋点工具：管理匿名 visitor_id + fire-and-forget 上报。
 * visitor_id 存 localStorage，跨页面/会话复用，用于串联同一访客的漏斗路径。
 */
import { websiteApi } from "@/api";

const VISITOR_ID_KEY = "demox_visitor_id";

function getVisitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id =
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10);
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

/**
 * 上报产品事件（fire-and-forget，绝不阻塞/抛错）。
 * @param eventName 事件名（landing_view / deploy_click / deploy_success / deploy_fail / example_click / feedback_copy）
 * @param props 附加属性
 */
export function track(
  eventName: string,
  props?: Record<string, unknown>
): void {
  try {
    const visitorId = getVisitorId();
    const page = typeof window !== "undefined" ? window.location.pathname : "";
    // fire-and-forget，不 await
    websiteApi.trackProductEvent(eventName, visitorId, page, props).catch(() => {});
  } catch {
    /* 埋点失败不影响任何功能 */
  }
}
