import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

/**
 * 危险操作的二次确认（设计规则：坏消息用墨色加图标，不用红色）。
 * - 标题前固定一个警告图标；
 * - 确认按钮是实心墨色，文字写清后果（「删除站点」「吊销令牌」），不要写「确定 / OK」；
 * - 取消按钮是描边样式。
 * 不要再用 window.confirm：浏览器原生弹窗只能显示「确定 / OK」。
 */
export type ConfirmDestructiveProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 按钮上的后果，例如「删除站点」/ "Delete site" */
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  /** 确认按钮里的图标，默认不加（标题已有警告图标） */
  icon?: React.ReactNode;
  children?: React.ReactNode;
};

export function ConfirmDestructive({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy = false,
  disabled = false,
  icon,
  children
}: ConfirmDestructiveProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <AlertDialogContent
        data-confirm-destructive
        className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{title}</span>
          </AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="text-[var(--stitch-muted)]">{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={busy}
            className="border-[var(--stitch-line)] bg-transparent text-[var(--stitch-ink)] hover:bg-[var(--stitch-blue-soft)]"
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            data-confirm-action
            disabled={busy || disabled}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            className="bg-[var(--stitch-ink)] font-semibold text-[var(--stitch-bg)] hover:bg-[var(--stitch-ink)] hover:opacity-90"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : icon}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
