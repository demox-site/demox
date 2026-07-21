import React from "react";

export function FeishuIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12.15 3.1 8.7 6.55l3.45 3.45 3.45-3.45-3.45-3.45Z" fill="#3370FF" />
      <path d="m6.55 8.7-3.45 3.45 3.45 3.45L10 12.15 6.55 8.7Z" fill="#00D6B9" />
      <path d="m17.45 8.7-3.45 3.45 3.45 3.45 3.45-3.45-3.45-3.45Z" fill="#7B67EE" />
      <path d="m12.15 14-3.45 3.45 3.45 3.45 3.45-3.45L12.15 14Z" fill="#FF5B6B" />
      <path d="m12.15 8.9-3.25 3.25 3.25 3.25 3.25-3.25-3.25-3.25Z" fill="currentColor" />
    </svg>
  );
}

export default FeishuIcon;
