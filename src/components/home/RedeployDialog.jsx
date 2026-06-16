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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.toastRedeployTitle}</DialogTitle>
          <DialogDescription>{t.toastRedeployDesc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              isDragActive
                ? "border-foreground/30 bg-muted/50"
                : "border-border bg-muted/20"
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
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-6 border border-border">
                <FolderOpen className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">
                {redeployFile ? t.redeploySelectedTitle : t.redeploySelectPrompt}
              </h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                {redeployFile ? redeployFile.name : t.redeployFileDesc}
              </p>
              <span className="px-6 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-md hover:opacity-90 transition-opacity inline-block">
                {redeployFile ? t.redeployChangeFile : t.redeployChooseFile}
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              {t.cancel}
            </Button>
            <Button disabled={!redeployFile} onClick={onConfirm}>
              {t.confirmUpload}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
