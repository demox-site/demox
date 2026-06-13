import React from "react";
// @ts-ignore;
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui";
// @ts-ignore;
import { FolderOpen } from "lucide-react";

/**
 * RedeployDialog
 * 重新部署弹窗：选择/拖拽 .zip 覆盖原站点。
 * 状态仍由父组件持有，这里只负责渲染与回调。
 * @param {{
 *   open:boolean, onOpenChange:(o:boolean)=>void,
 *   redeployFile:File|null, isDragActive:boolean,
 *   onDragEnter:Function, onDragOver:Function, onDragLeave:Function, onDrop:Function,
 *   onFileChange:Function, onCancel:()=>void, onConfirm:()=>void,
 *   t:Record<string,string>
 * }} props
 */
export default function RedeployDialog({
  open,
  onOpenChange,
  redeployFile,
  isDragActive,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
  onCancel,
  onConfirm,
  t
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">{t.toastRedeployTitle}</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {t.toastRedeployDesc}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              isDragActive
                ? "border-zinc-600 bg-zinc-900/30"
                : "border-zinc-800 bg-zinc-900/20"
            }`}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              id="redeploy-file-input"
              type="file"
              accept=".zip"
              onChange={onFileChange}
              className="hidden"
            />
            <label htmlFor="redeploy-file-input" className="cursor-pointer">
              <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mx-auto mb-6 border border-zinc-800">
                <FolderOpen className="w-8 h-8 text-zinc-400" />
              </div>
              <h3 className="text-xl font-bold text-zinc-100 mb-2">
                {redeployFile ? t.redeploySelectedTitle : t.redeploySelectPrompt}
              </h3>
              <p className="text-zinc-500 mb-6 max-w-sm mx-auto">
                {redeployFile ? redeployFile.name : t.redeployFileDesc}
              </p>
              <span className="px-6 py-2 bg-zinc-100 text-black text-sm font-bold rounded-md hover:bg-zinc-300 transition-colors">
                {redeployFile ? t.redeployChangeFile : t.redeployChooseFile}
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
              onClick={onCancel}
            >
              {t.cancel}
            </Button>
            <Button
              variant="outline"
              className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 hover:border-zinc-100"
              disabled={!redeployFile}
              onClick={onConfirm}
            >
              {t.confirmUpload}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
