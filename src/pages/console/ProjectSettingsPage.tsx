import { Navigate, useParams } from "react-router-dom";

/** 自定义域名已挪到站点详情；旧地址继续跳到站点列表。 */
export default function ProjectSettingsPage() {
  const { projectId = "" } = useParams();
  return <Navigate to={`/console/projects/${projectId}/sites`} replace />;
}
