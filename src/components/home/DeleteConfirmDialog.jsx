import React from "react";
import { Trash2 } from "lucide-react";
import { ConfirmDestructive } from "@/components/ui/confirm-destructive";

/**
 * DeleteConfirmDialog
 * 删除站点的二次确认弹窗：墨色实心按钮 + 警告图标，按钮写清后果（「删除站点」）。
 */
export default function DeleteConfirmDialog({ open, onOpenChange, onConfirm, t }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title={t.deleteConfirmTitle}
      description={t.deleteConfirmDesc}
      confirmLabel={t.deleteConfirmButton}
      cancelLabel={t.cancel}
      icon={<Trash2 className="mr-2 h-4 w-4" aria-hidden />}
      busy={busy}
      onConfirm={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
