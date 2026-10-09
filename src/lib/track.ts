/**
 * 产品漏斗埋点工具：管理匿名 visitor_id + fire-and-forget 上报。
 * visitor_id 存 localStorage，跨页面/会话复用，用于串联同一访客的漏斗路径。
 */
import { websiteApi } from "@/api";
import { getVisitorId } from "@/lib/visitor-id";

/**
 * 上报产品事件（fire-and-forget，绝不阻塞/抛错）。
 * @param eventName 事件名（landing_view / deploy_click / intent_guide_click / example_click / feedback_copy / usecase_click）。
 * 新增事件要同步加到 website-api 的 PRODUCT_EVENT_NAMES。deploy_success / deploy_fail 由服务端记录，前端不要再报。
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
