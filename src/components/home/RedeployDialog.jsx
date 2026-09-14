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
      <DialogContent className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)] sm:rounded-[1.5rem]">
        <DialogHeader>
          <DialogTitle>{t.toastRedeployTitle}</DialogTitle>
          <DialogDescription>{t.toastRedeployDesc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div
            className={`stitch-dropzone p-12 text-center transition-colors ${
              isDragActive ? "stitch-dropzone-active" : ""
            }`}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              id="redeploy-file-input"
              type="file"
              accept=".zip,.html,.htm"
              onChange={onFileChange}
              className="hidden"
            />
            <label htmlFor="redeploy-file-input" className="cursor-pointer">
              <div className="stitch-icon-tile mx-auto mb-6 h-16 w-16 rounded-full">
                <FolderOpen className="h-8 w-8" />
              </div>
              <h3 className="mb-2 text-xl font-bold text-[var(--stitch-ink)]">
                {redeployFile ? t.redeploySelectedTitle : t.redeploySelectPrompt}
              </h3>
              <p className="mx-auto mb-6 max-w-sm text-[var(--stitch-muted)]">
                {redeployFile ? redeployFile.name : t.redeployFileDesc}
              </p>
              <span className="stitch-primary inline-block rounded-full px-6 py-2 text-sm font-bold">
                {redeployFile ? t.redeployChangeFile : t.redeployChooseFile}
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="stitch-action rounded-full" onClick={onCancel}>
              {t.cancel}
            </Button>
            <Button className="stitch-primary rounded-full" disabled={!redeployFile} onClick={onConfirm}>
              {t.confirmUpload}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
