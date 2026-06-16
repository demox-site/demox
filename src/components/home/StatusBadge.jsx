import React from "react";
// @ts-ignore;
import { Badge } from "@/components/ui";
// @ts-ignore;
import { CheckCircle, Clock, XCircle, AlertCircle } from "lucide-react";

/**
 * StatusBadge
 * 根据站点部署状态渲染对应颜色/图标的徽章。
 * @param {{ status: string, t: Record<string,string> }} props
 */
export default function StatusBadge({ status, t }) {
  switch (status) {
    case "deployed":
      return (
        <Badge variant="success">
          <CheckCircle className="w-3 h-3 mr-1" />
          {t.statusDeployed}
        </Badge>
      );
    case "processing":
      return (
        <Badge variant="warning">
          <Clock className="w-3 h-3 mr-1" />
          {t.statusProcessing}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <XCircle className="w-3 h-3 mr-1" />
          {t.statusFailed}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          <AlertCircle className="w-3 h-3 mr-1" />
          {t.statusUnknown}
        </Badge>
      );
  }
}
