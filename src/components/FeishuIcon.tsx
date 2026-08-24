import React from "react";
import feishuIcon from "@/assets/feishu-icon.png";

export function FeishuIcon({ className = "" }: { className?: string }) {
  return (
    <img
      src={feishuIcon}
      alt=""
      aria-hidden="true"
      className={className}
      draggable={false}
    />
  );
}

export default FeishuIcon;
