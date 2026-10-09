/**
 * 匿名访客 ID（localStorage），用于串联产品漏斗：
 * landing_view → deploy_click → 服务端记录的 deploy_success。
 */
const VISITOR_ID_KEY = "demox_visitor_id";

export function getVisitorId(): string {
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
