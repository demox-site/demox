import React from "react";
// @ts-ignore;
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui";

/**
 * DeleteConfirmDialog
 * 删除站点的二次确认弹窗。
 * @param {{ open:boolean, onOpenChange:(o:boolean)=>void, onConfirm:()=>void, t:Record<string,string> }} props
 */
export default function DeleteConfirmDialog({ open, onOpenChange, onConfirm, t }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-zinc-900 border-zinc-800">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-zinc-100">{t.deleteConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription className="text-zinc-400">
            {t.deleteConfirmDesc}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
            {t.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-900/30 text-red-500 border border-red-900 hover:bg-red-900/50 hover:text-red-400"
            onClick={onConfirm}
          >
            {t.deleteConfirmButton}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
