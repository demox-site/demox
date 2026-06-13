import React from "react";
// @ts-ignore;
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress
} from "@/components/ui";
// @ts-ignore;
import { Upload, FolderOpen } from "lucide-react";

/**
 * UploadSection
 * 首页顶部的「部署新项目」上传区（拖拽 + 选择文件 + 进度）。
 * 状态由父组件持有，这里只渲染与回调。
 * @param {{
 *   t:Record<string,any>, roleLimits:any,
 *   isDragActive:boolean, setIsDragActive:Function,
 *   uploadZipFile:(file:File|null)=>Promise<void>,
 *   fileInputRef:React.RefObject<any>, onFileChange:Function,
 *   uploading:boolean, uploadStatusText:string,
 *   uploadProgress:number, uploadStage:number, funnyMessage:string
 * }} props
 */
export default function UploadSection({
  t,
  roleLimits,
  isDragActive,
  setIsDragActive,
  uploadZipFile,
  fileInputRef,
  onFileChange,
  uploading,
  uploadStatusText,
  uploadProgress,
  uploadStage,
  funnyMessage
}) {
  return (
    <Card className="bg-zinc-950/50 border-zinc-900 backdrop-blur-sm mb-12 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-900/20 to-transparent pointer-events-none" />
      <CardHeader className="border-b border-zinc-900 bg-zinc-900/30">
        <CardTitle className="text-zinc-100 flex items-center gap-2">
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
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            isDragActive
              ? "border-zinc-600 bg-zinc-900/30"
              : "border-zinc-800 bg-zinc-900/20"
          } group-hover:bg-zinc-900/30`}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragActive(true);
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
            const items = e.dataTransfer?.files;
            const file = items && items.length > 0 ? items[0] : null;
            await uploadZipFile(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={onFileChange}
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
            <p className="text-zinc-500 mb-6 max-w-sm mx-auto">{t.uploadDesc}</p>
            {!uploading && (
              <span className="px-6 py-2 bg-zinc-100 text-black text-sm font-bold rounded-md hover:bg-zinc-300 transition-colors">
                {t.uploadButton}
              </span>
            )}
          </label>
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
      </CardContent>
    </Card>
  );
}
