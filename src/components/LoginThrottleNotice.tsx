import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { throttleMessage } from "@/lib/login-throttle";

/**
 * 登录限速提示：墨色 + 时钟图标，不用红色（不是出错，是请稍等）。倒计时到 0 自动消失。
 */
export function LoginThrottleNotice({ until, lang = "zh", onDone }: { until: number; lang?: "zh" | "en"; onDone?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = until - now;
  useEffect(() => {
    if (left <= 0) onDone?.();
  }, [left, onDone]);
  if (left <= 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="login-throttle-notice"
      className="flex items-start gap-2 rounded-lg border border-foreground/25 bg-foreground/[0.04] px-3 py-2.5 text-sm leading-relaxed text-foreground"
    >
      <Clock className="mt-[3px] h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{throttleMessage(left, lang)}</span>
    </div>
  );
}
