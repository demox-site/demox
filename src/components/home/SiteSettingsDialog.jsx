import React, { useState, useEffect } from "react";
// @ts-ignore;
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Label,
  Textarea,
  useToast
} from "@/components/ui";
// @ts-ignore;
import { Search, Loader2 } from "lucide-react";
import { websiteApi } from "@/api";

/**
 * SiteSettingsDialog
 * 站点 SEO 设置弹窗：自定义 title / description / og:image。
 * 边缘函数在回源时向 <head> 注入对应 meta 标签。
 * 保存后约 60s 边缘缓存刷新后生效。
 * @param {{
 *   open:boolean, onOpenChange:(o:boolean)=>void,
 *   website:any, t:Record<string,any>, lang:string,
 *   onSaved?:(seo:any)=>void
 * }} props
 */
export default function SiteSettingsDialog({
  open,
  onOpenChange,
  website,
  t,
  lang,
  onSaved
}) {
  const { toast } = useToast();
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [ogImage, setOgImage] = useState("");
  const [saving, setSaving] = useState(false);

  // 打开时用 website 字段初始化
  useEffect(() => {
    if (open && website) {
      setSeoTitle(website.seoTitle || website.seo_title || "");
      setSeoDescription(website.seoDescription || website.seo_description || "");
      setOgImage(website.ogImage || website.og_image || "");
    }
  }, [open, website]);

  const handleSave = async () => {
    if (!website) return;
    setSaving(true);
    try {
      const res = await websiteApi.updateSeo({
        websiteId: website.website_id || website._id,
        docId: website._id && website._id !== website.website_id ? String(website._id) : undefined,
        seoTitle: seoTitle.trim(),
        seoDescription: seoDescription.trim(),
        ogImage: ogImage.trim()
      });
      if (res.success) {
        toast({
          title: lang === "zh" ? "SEO 设置已保存" : "SEO settings saved",
          description: lang === "zh"
            ? "边缘缓存约 60s 后生效"
            : "Takes effect after edge cache refreshes (~60s)"
        });
        if (onSaved) onSaved(res.seo);
        onOpenChange(false);
      } else {
        toast({
          title: lang === "zh" ? "保存失败" : "Save failed",
          description: res.message || "",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: lang === "zh" ? "保存失败" : "Save failed",
        description: error?.message || "",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const siteUrl = website?.url || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)] sm:rounded-[1.5rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--stitch-ink)]">
            <Search className="h-5 w-5 text-[var(--stitch-muted)]" />
            {lang === "zh" ? "SEO 设置" : "SEO Settings"}
          </DialogTitle>
          <DialogDescription className="text-[var(--stitch-muted)]">
            {lang === "zh"
              ? "自定义分享到微信/Twitter/搜索引擎时的标题、描述和配图。留空则使用站点名称或不注入。"
              : "Customize title, description and preview image when shared to WeChat/Twitter/search engines. Leave empty to use site name or skip."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {siteUrl && (
            <div className="rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-2">
              <span className="text-xs text-[var(--stitch-muted)]">{lang === "zh" ? "当前站点" : "Site"}</span>
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-mono text-sm text-[var(--stitch-ink)] hover:underline"
              >
                {siteUrl}
              </a>
            </div>
          )}

          <div className="space-y-2">
            <Label>
              {lang === "zh" ? "SEO 标题" : "SEO Title"}
            </Label>
            <Input
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              placeholder={website?.name || (lang === "zh" ? "留空使用站点名称" : "Leave empty to use site name")}
              maxLength={255}
              className="rounded-xl border-[var(--stitch-line)] bg-[var(--stitch-surface)]"
            />
            <p className="text-xs text-[var(--stitch-muted)]">
              {lang === "zh" ? "显示在浏览器标签和搜索结果标题。最多 255 字符。" : "Shown in browser tab and search results. Max 255 chars."}
            </p>
          </div>

          <div className="space-y-2">
            <Label>
              {lang === "zh" ? "SEO 描述" : "Description"}
            </Label>
            <Textarea
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              placeholder={lang === "zh" ? "一句话描述这个页面" : "One sentence describing this page"}
              maxLength={500}
              rows={3}
              className="resize-none rounded-xl border-[var(--stitch-line)] bg-[var(--stitch-surface)]"
            />
            <p className="text-xs text-[var(--stitch-muted)]">
              {lang === "zh" ? "显示在搜索结果和社交分享摘要中。最多 500 字符。" : "Shown in search results and social share previews. Max 500 chars."}
            </p>
          </div>

          <div className="space-y-2">
            <Label>
              {lang === "zh" ? "OG 配图 URL" : "OG Image URL"}
            </Label>
            <Input
              value={ogImage}
              onChange={(e) => setOgImage(e.target.value)}
              placeholder="https://example.com/cover.png"
              maxLength={500}
              className="rounded-xl border-[var(--stitch-line)] bg-[var(--stitch-surface)]"
            />
            <p className="text-xs text-[var(--stitch-muted)]">
              {lang === "zh"
                ? "分享到微信/Twitter 时的预览图。建议 1200×630，填完整 URL。"
                : "Preview image when shared to WeChat/Twitter. Recommended 1200×630. Full URL required."}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="stitch-action rounded-full"
            >
              {lang === "zh" ? "取消" : "Cancel"}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="stitch-primary rounded-full"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {lang === "zh" ? "保存" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
