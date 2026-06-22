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
import { Upload, FolderOpen, FileText, FileType, Archive, Check, Table, Code } from "lucide-react";
import { docTemplates, defaultTemplateId } from "@/lib/doc-templates";
import { isSupportedDoc, SUPPORTED_DOC_EXTENSIONS } from "@/lib/doc-to-site";
import { isSupportedPdf, SUPPORTED_PDF_EXTENSIONS } from "@/lib/pdf-to-site";
import { isSupportedSpreadsheet, SUPPORTED_SPREADSHEET_EXTENSIONS } from "@/lib/spreadsheet-to-site";

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
  uploadSpreadsheetFile,
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
  const allAccept = [".zip", ...SUPPORTED_DOC_EXTENSIONS, ...SUPPORTED_PDF_EXTENSIONS, ...SUPPORTED_SPREADSHEET_EXTENSIONS].join(",");

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

    if (isSupportedSpreadsheet(file)) {
      await uploadSpreadsheetFile(file);
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
    <Card className="stitch-panel mb-12 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--stitch-blue-soft)] to-transparent pointer-events-none" />
      <CardHeader className="border-b border-[var(--stitch-line)] bg-[var(--stitch-surface)]">
        <CardTitle className="text-[var(--stitch-ink)] flex items-center gap-2 flex-wrap">
          <Upload className="w-5 h-5 text-[var(--stitch-blue)]" />
          {t.uploadCardTitle}
          {roleLimits && (
            <span className="text-xs text-[var(--stitch-muted)] font-mono ml-2 font-normal">
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
          className={`stitch-dropzone p-12 text-center transition-colors ${
            isDragActive
              ? "stitch-dropzone-active"
              : ""
          }`}
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
            <div className="stitch-icon-tile mx-auto mb-6 h-16 w-16 rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <FolderOpen className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-[var(--stitch-ink)] mb-2">
              {uploading ? t.uploadTitleUploading : t.uploadTitleIdle}
            </h3>
            <p className="text-[var(--stitch-muted)] mb-6 max-w-xl mx-auto">{t.uploadDesc}</p>
            {!uploading && (
              <span className="stitch-primary inline-flex rounded-full px-6 py-2 text-sm font-bold transition-colors">
                {t.uploadButton}
              </span>
            )}
          </label>
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-[var(--stitch-muted)]">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-1">
              <Archive className="h-3.5 w-3.5" />
              {t.uploadFormatZip}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-1">
              <FileType className="h-3.5 w-3.5" />
              {t.uploadFormatPdf}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-1">
              <Table className="h-3.5 w-3.5" />
              {t.uploadFormatSheet}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-1">
              <Code className="h-3.5 w-3.5" />
              {t.uploadFormatHtml}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-1">
              <FileText className="h-3.5 w-3.5" />
              {t.uploadFormatDoc}
            </span>
          </div>
        </div>

        {uploading && (
          <div className="mt-8 max-w-xl mx-auto">
            <div className="flex justify-between text-xs font-mono text-[var(--stitch-muted)] mb-2">
              <span>{uploadStatusText || t.uploadProgressLabel}</span>
              <span>
                {uploadProgress}% ({uploadStage}/3){" "}
              </span>
            </div>
            <Progress
              value={uploadProgress}
              className="bg-[var(--stitch-line)] h-2"
              indicatorClassName={
                uploadStage === 1
                  ? "bg-[var(--stitch-ink)]"
                  : uploadStage === 2
                  ? "bg-[var(--stitch-ink)]"
                  : uploadStage === 3
                  ? "bg-[var(--stitch-ink)]"
                  : "bg-[var(--stitch-ink)]"
              }
            />
            <div className="text-center mt-2 text-xs text-[var(--stitch-muted)] animate-pulse">
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
          <DialogContent className="max-w-2xl border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]">
            <DialogHeader>
              <DialogTitle className="text-[var(--stitch-ink)]">
                {t.docTemplateDialogTitle}
              </DialogTitle>
              <DialogDescription className="text-[var(--stitch-muted)]">
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
                        ? "border-[var(--stitch-blue)] ring-1 ring-[var(--stitch-blue)]"
                        : "border-[var(--stitch-line)] hover:border-[var(--stitch-blue)]"
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
                    <div className="text-sm font-bold text-[var(--stitch-ink)]">
                      {tpl.name[L]}
                    </div>
                    <div className="text-xs text-[var(--stitch-muted)] mt-0.5">
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
                className="mt-2 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-4 py-2 text-sm font-medium text-[var(--stitch-muted)] transition-colors hover:bg-[var(--stitch-blue-soft)] hover:text-[var(--stitch-ink)] disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={uploading || !pendingDocFile}
                onClick={confirmTemplateUpload}
                className="stitch-primary rounded-full px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
