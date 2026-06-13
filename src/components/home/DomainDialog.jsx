import React from "react";
// @ts-ignore;
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input
} from "@/components/ui";
// @ts-ignore;
import { Link2, Pencil, X, Loader2, Copy, Check, XCircle } from "lucide-react";

/**
 * DomainDialog
 * 自定义子域名前缀的设置弹窗（绑定/解绑/实时可用性检测）。
 * 状态由父组件持有，这里只渲染与回调。
 * @param {{
 *   open:boolean, onOpenChange:(o:boolean)=>void,
 *   domainInfo:{subdomain:string}|null, setDomainInfo:Function,
 *   domainInput:string, setDomainInput:Function,
 *   domainCheck:{status:string,message:string}, domainBusy:boolean,
 *   onBind:()=>void, onUnbind:()=>void, onCopy:(text:string)=>void,
 *   t:Record<string,string>
 * }} props
 */
export default function DomainDialog({
  open,
  onOpenChange,
  domainInfo,
  setDomainInfo,
  domainInput,
  setDomainInput,
  domainCheck,
  domainBusy,
  onBind,
  onUnbind,
  onCopy,
  t
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 flex items-center gap-2">
            <Link2 className="w-5 h-5 text-zinc-400" />
            {t.domainDialogTitle}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {t.domainDialogDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {domainInfo && domainInfo.subdomain ? (
            <div className="space-y-4">
              <p className="text-xs text-zinc-500">{t.domainCnameTip}</p>
              <div className="flex items-center gap-2 px-3 py-2 rounded bg-zinc-950 border border-zinc-800">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <a
                  href={`https://${domainInfo.subdomain}.demox.site`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-200 text-sm font-mono truncate hover:underline flex-1"
                >
                  {domainInfo.subdomain}.demox.site
                </a>
                <button
                  onClick={() => onCopy(`https://${domainInfo.subdomain}.demox.site`)}
                  className="text-zinc-500 hover:text-zinc-200"
                  title={t.domainCopy}
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDomainInfo(null);
                    setDomainInput(domainInfo.subdomain);
                  }}
                  className="border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  {t.editName}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onUnbind}
                  disabled={domainBusy}
                  className="border-zinc-800 bg-zinc-900 text-red-400 hover:bg-red-950/40 hover:text-red-300 hover:border-red-900"
                >
                  {domainBusy ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <X className="w-4 h-4 mr-2" />
                  )}
                  {t.domainUnbindButton}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-sm text-zinc-400">{t.domainInputLabel}</label>
              <div className="flex items-center gap-2">
                <div
                  className={`flex items-center flex-1 rounded bg-zinc-950 border overflow-hidden focus-within:border-zinc-600 ${
                    domainCheck.status === "taken" || domainCheck.status === "invalid"
                      ? "border-red-500/70"
                      : domainCheck.status === "ok"
                      ? "border-green-500/60"
                      : "border-zinc-800"
                  }`}
                >
                  <Input
                    value={domainInput}
                    onChange={(e) =>
                      setDomainInput(
                        e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                      )
                    }
                    placeholder={t.domainInputPlaceholder}
                    className="border-0 bg-transparent text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-0 focus-visible:ring-offset-0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && domainCheck.status === "ok" && !domainBusy) onBind();
                    }}
                  />
                  <span className="px-3 text-sm text-zinc-500 font-mono whitespace-nowrap select-none">
                    .demox.site
                  </span>
                </div>
                <Button
                  onClick={onBind}
                  disabled={domainBusy || !domainInput.trim() || domainCheck.status !== "ok"}
                  className="bg-zinc-100 text-black hover:bg-zinc-300 shrink-0 disabled:opacity-40"
                >
                  {domainBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    t.domainBindButton
                  )}
                </Button>
              </div>
              {/* 检测状态行 */}
              {domainCheck.status === "checking" && (
                <p className="text-xs text-zinc-500 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t.domainChecking}
                </p>
              )}
              {domainCheck.status === "ok" && domainInput.trim() && (
                <p className="text-xs text-green-500 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {t.domainAvailable}
                </p>
              )}
              {(domainCheck.status === "taken" || domainCheck.status === "invalid") && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {domainCheck.message || (domainCheck.status === "taken" ? t.domainTaken : t.domainHint)}
                </p>
              )}
              {domainCheck.status === "idle" && (
                <p className="text-xs text-zinc-600">{t.domainHint}</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
