import React from "react";
// @ts-ignore;
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress
} from "@/components/ui";
// @ts-ignore;
import { Upload, FolderOpen, FileText, FileType, Archive, Check } from "lucide-react";
import { docTemplates, defaultTemplateId } from "@/lib/doc-templates";
import { isSupportedDoc, SUPPORTED_DOC_EXTENSIONS } from "@/lib/doc-to-site";
import { isSupportedPdf, SUPPORTED_PDF_EXTENSIONS } from "@/lib/pdf-to-site";

/**
 * UploadSection
 * 首页顶部的「部署新项目」上传区。一个入口自动识别 zip / doc / pdf。
 * 纯文档格式会先弹出模板选择，再生成站点并复用既有部署流程。
 * @param {{
 *   t:Record<string,any>, lang:string, roleLimits:any,
 *   isDragActive:boolean, setIsDragActive:Function,
 *   uploadZipFile:(file:File|null)=>Promise<void>,
 *   uploadDocFile:(file:File|null, templateId:string)=>Promise<void>,
 *   uploadPdfFile:(file:File|null)=>Promise<void>,
 *   fileInputRef:React.RefObject<any>,
 *   uploading:boolean, uploadStatusText:string,
 *   uploadProgress:number, uploadStage:number, funnyMessage:string
 * }} props
 */
export default function UploadSection({
  t,
  lang,
  roleLimits,
  isDragActive,
  setIsDragActive,
  uploadZipFile,
  uploadDocFile,
  uploadPdfFile,
  fileInputRef,
  uploading,
  uploadStatusText,
  uploadProgress,
  uploadStage,
  funnyMessage
}) {
  const [templateId, setTemplateId] = React.useState(defaultTemplateId);
  const [pendingDocFile, setPendingDocFile] = React.useState(null);
  const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false);
  const L = lang === "en" ? "en" : "zh";
  const allAccept = [".zip", ...SUPPORTED_DOC_EXTENSIONS, ...SUPPORTED_PDF_EXTENSIONS].join(",");

  const isZipFile = (file) =>
    !!file && String(file.name || "").toLowerCase().endsWith(".zip");

  const resetFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openTemplateDialog = (file) => {
    setPendingDocFile(file);
    setTemplateDialogOpen(true);
  };

  const closeTemplateDialog = () => {
    setTemplateDialogOpen(false);
    setPendingDocFile(null);
    resetFileInput();
  };

  const handleFiles = async (fileList) => {
    const file = fileList && fileList.length > 0 ? fileList[0] : null;
    if (!file || uploading) return;

    if (isZipFile(file)) {
      await uploadZipFile(file);
      return;
    }

    if (isSupportedPdf(file)) {
      await uploadPdfFile(file);
      return;
    }

    if (isSupportedDoc(file)) {
      openTemplateDialog(file);
      return;
    }

    await uploadZipFile(file);
  };

  const handleInputChange = async (event) => {
    await handleFiles(event.target.files);
    event.target.value = "";
  };

  const confirmTemplateUpload = async () => {
    const file = pendingDocFile;
    setTemplateDialogOpen(false);
    setPendingDocFile(null);
    resetFileInput();
    if (file) await uploadDocFile(file, templateId);
  };

  return (
    <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm mb-12 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-900/20 to-transparent pointer-events-none" />
      <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
        <CardTitle className="text-zinc-100 flex items-center gap-2 flex-wrap">
          <Upload className="w-5 h-5 text-zinc-400" />
          {t.uploadCardTitle}
          {roleLimits && (
            <span className="text-xs text-zinc-500 font-mono ml-2 font-normal">
              ({t.uploadLimitPrefix}{" "}
              {roleLimits.max_file_size
                ? Math.round(roleLimits.max_file_size / 1024 / 1024) + "MB"
                : t.uploadLimitUnlimited}
              , {t.uploadLimitFilesPrefix}{" "}
              {roleLimits.max_file_count
                ? roleLimits.max_file_count
                : t.uploadLimitUnlimited}
              )
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-8">
        {/* 拖拽 / 选择区 */}
        <div
          data-testid="upload-dropzone"
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            isDragActive
              ? "border-zinc-600 bg-zinc-900/30"
              : "border-zinc-800 bg-zinc-900/20"
          } group-hover:bg-zinc-900/30`}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!uploading) setIsDragActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!uploading) setIsDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragActive(false);
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragActive(false);
            if (uploading) return;
            await handleFiles(e.dataTransfer?.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={allAccept}
            onChange={handleInputChange}
            className="hidden"
            id="file-upload"
            disabled={uploading}
          />
          <label
            htmlFor="file-upload"
            className={`cursor-pointer ${
              uploading ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mx-auto mb-6 border border-zinc-800 group-hover:scale-110 transition-transform duration-300">
              <FolderOpen className="w-8 h-8 text-zinc-400" />
            </div>
            <h3 className="text-xl font-bold text-zinc-100 mb-2">
              {uploading ? t.uploadTitleUploading : t.uploadTitleIdle}
            </h3>
            <p className="text-zinc-500 mb-6 max-w-xl mx-auto">{t.uploadDesc}</p>
            {!uploading && (
              <span className="px-6 py-2 bg-zinc-100 text-black text-sm font-bold rounded-md hover:bg-zinc-300 transition-colors">
                {t.uploadButton}
              </span>
            )}
          </label>
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1">
              <Archive className="h-3.5 w-3.5" />
              {t.uploadFormatZip}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1">
              <FileType className="h-3.5 w-3.5" />
              {t.uploadFormatPdf}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1">
              <FileText className="h-3.5 w-3.5" />
              {t.uploadFormatDoc}
            </span>
          </div>
        </div>

        {uploading && (
          <div className="mt-8 max-w-xl mx-auto">
            <div className="flex justify-between text-xs font-mono text-zinc-400 mb-2">
              <span>{uploadStatusText || t.uploadProgressLabel}</span>
              <span>
                {uploadProgress}% ({uploadStage}/3){" "}
              </span>
            </div>
            <Progress
              value={uploadProgress}
              className="bg-zinc-900 h-2"
              indicatorClassName={
                uploadStage === 1
                  ? "bg-blue-400"
                  : uploadStage === 2
                  ? "bg-amber-400"
                  : uploadStage === 3
                  ? "bg-lime-400"
                  : "bg-primary"
              }
            />
            <div className="text-center mt-2 text-xs text-zinc-500 animate-pulse">
              {funnyMessage}
            </div>
          </div>
        )}

        <Dialog open={templateDialogOpen} onOpenChange={(open) => {
          if (open) {
            setTemplateDialogOpen(true);
          } else {
            closeTemplateDialog();
          }
        }}>
          <DialogContent className="max-w-2xl border-zinc-800 bg-zinc-950 text-zinc-100">
            <DialogHeader>
              <DialogTitle className="text-zinc-100">
                {t.docTemplateDialogTitle}
              </DialogTitle>
              <DialogDescription className="text-zinc-500">
                {t.docTemplateDialogDesc}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {docTemplates.map((tpl) => {
                const selected = tpl.id === templateId;
                const c = tpl.previewColors;
                return (
                  <button
                    type="button"
                    key={tpl.id}
                    disabled={uploading}
                    onClick={() => setTemplateId(tpl.id)}
                    className={`relative text-left rounded-lg border p-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      selected
                        ? "border-zinc-100 ring-1 ring-zinc-100"
                        : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    {selected && (
                      <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-zinc-100 text-black flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                    <div
                      className="h-16 rounded-md mb-3 flex items-end p-2 overflow-hidden"
                      style={{ background: c.bg }}
                    >
                      <div className="space-y-1 w-full">
                        <div
                          className="h-2 rounded-full w-1/2"
                          style={{ background: c.accent }}
                        />
                        <div
                          className="h-1.5 rounded-full w-full opacity-70"
                          style={{ background: c.fg }}
                        />
                        <div
                          className="h-1.5 rounded-full w-4/5 opacity-40"
                          style={{ background: c.fg }}
                        />
                      </div>
                    </div>
                    <div className="text-sm font-bold text-zinc-100">
                      {tpl.name[L]}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {tpl.desc[L]}
                    </div>
                  </button>
                );
              })}
            </div>

            <DialogFooter>
              <button
                type="button"
                disabled={uploading}
                onClick={closeTemplateDialog}
                className="mt-2 rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={uploading || !pendingDocFile}
                onClick={confirmTemplateUpload}
                className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.docTemplateConfirm}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
