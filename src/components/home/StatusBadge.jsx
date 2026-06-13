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
        <Badge className="bg-green-500/10 text-green-500 border-green-500/20 border">
          <CheckCircle className="w-3 h-3 mr-1" />
          {t.statusDeployed}
        </Badge>
      );
    case "processing":
      return (
        <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 border">
          <Clock className="w-3 h-3 mr-1" />
          {t.statusProcessing}
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/10 text-red-500 border-red-500/20 border">
          <XCircle className="w-3 h-3 mr-1" />
          {t.statusFailed}
        </Badge>
      );
    default:
      return (
        <Badge className="bg-zinc-500/10 text-zinc-500 border-zinc-500/20 border">
          <AlertCircle className="w-3 h-3 mr-1" />
          {t.statusUnknown}
        </Badge>
      );
  }
}
