import React, { useCallback, useEffect, useMemo, useState } from "react";
import { galleryAdminApi, type GalleryAdminCard } from "@/api";
import { Button, Card, CardContent, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from "@/components/ui";
import { useToast } from "@/components/ui";
import { useLanguage } from "@/hooks/use-language";
import { AlertCircle, ArrowDown, ArrowUp, Plus, RefreshCw } from "lucide-react";

type Preview = GalleryAdminCard["preview"];

type Draft = {
  id: string;
  title: string;
  titleEn: string;
  url: string;
  href: string;
  preview: Preview;
  image: string;
  caption: string;
  captionEn: string;
  row: 1 | 2;
  enabled: boolean;
};

const emptyDraft = (): Draft => ({
  id: "",
  title: "",
  titleEn: "",
  url: "https://",
  href: "",
  preview: "image",
  image: "https://",
  caption: "",
  captionEn: "",
  row: 1,
  enabled: true
});

const copy = {
  zh: {
    title: "作品墙",
    sub: "配置首页两行作品。两行都有已启用的卡片时，首页改用这里的列表；否则仍显示内置卡片。链接和截图只能是 https://*.demox.site。",
    add: "添加卡片",
    refresh: "刷新",
    loading: "加载中...",
    empty: "还没有卡片。首页会继续使用内置作品墙。",
    row: (n: 1 | 2) => `第 ${n} 行`,
    enabled: "已启用",
    disabled: "已停用",
    enable: "启用",
    disable: "停用",
    edit: "编辑",
    up: "上移",
    down: "下移",
    save: "保存",
    cancel: "取消",
    saving: "保存中...",
    createTitle: "添加卡片",
    editTitle: "编辑卡片",
    dialogHint: "英文标题和说明留空时，英文首页回退到中文。",
    id: "卡片 id",
    titleField: "标题",
    titleEn: "英文标题",
    caption: "说明",
    captionEn: "英文说明",
    url: "站点链接",
    href: "点击地址（可空）",
    image: "截图地址",
    preview: "预览",
    rowField: "所在行",
    show: "在首页显示",
    loadFail: "作品墙列表没有加载出来",
    saveFail: "没有保存",
    saved: "已保存"
  },
  en: {
    title: "Gallery",
    sub: "Homepage rows. The homepage uses this list only when both rows have an enabled card; otherwise it keeps the built-in cards. Links and images must be https://*.demox.site.",
    add: "Add card",
    refresh: "Refresh",
    loading: "Loading...",
    empty: "No cards yet. The homepage keeps the built-in wall.",
    row: (n: 1 | 2) => `Row ${n}`,
    enabled: "Enabled",
    disabled: "Disabled",
    enable: "Enable",
    disable: "Disable",
    edit: "Edit",
    up: "Up",
    down: "Down",
    save: "Save",
    cancel: "Cancel",
    saving: "Saving...",
    createTitle: "Add card",
    editTitle: "Edit card",
    dialogHint: "Leave the English fields empty to fall back to the original title and caption.",
    id: "Card id",
    titleField: "Title",
    titleEn: "English title",
    caption: "Caption",
    captionEn: "English caption",
    url: "Site URL",
    href: "Click target (optional)",
    image: "Image URL",
    preview: "Preview",
    rowField: "Row",
    show: "Show on the homepage",
    loadFail: "Could not load the gallery",
    saveFail: "Not saved",
    saved: "Saved"
  }
};

function toDraft(card: GalleryAdminCard): Draft {
  return {
    id: card.id,
    title: card.title,
    titleEn: card.titleEn || "",
    url: card.url,
    href: card.href || "",
    preview: card.preview,
    image: card.image || "",
    caption: card.caption || "",
    captionEn: card.captionEn || "",
    row: card.row,
    enabled: card.enabled
  };
}

const fieldClass = "mt-1 border-zinc-700 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500";

const AdminGallery: React.FC = () => {
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = language === "en" ? copy.en : copy.zh;
  const [cards, setCards] = useState<GalleryAdminCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await galleryAdminApi.list();
      if (!res?.success) {
        setError(res?.message || t.loadFail);
        setCards([]);
        return;
      }
      setCards(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadFail);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [t.loadFail]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const sort = (row: 1 | 2) => cards.filter((card) => card.row === row).sort((a, b) => (a.order || 0) - (b.order || 0));
    return { 1: sort(1), 2: sort(2) } as const;
  }, [cards]);

  const openCreate = (row: 1 | 2) => {
    setEditing(false);
    setDraft({ ...emptyDraft(), row });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await galleryAdminApi.save({
        id: draft.id.trim(),
        title: draft.title.trim(),
        titleEn: draft.titleEn.trim(),
        url: draft.url.trim(),
        href: draft.href.trim(),
        preview: draft.preview,
        image: draft.preview === "image" ? draft.image.trim() : draft.image.trim(),
        caption: draft.caption.trim(),
        captionEn: draft.captionEn.trim(),
        row: draft.row,
        enabled: draft.enabled
      });
      if (!res?.success) {
        toast({ title: t.saveFail, description: res?.message || t.saveFail });
        return;
      }
      toast({ title: t.saved });
      setDraft(null);
      await load();
    } catch (err) {
      toast({ title: t.saveFail, description: err instanceof Error ? err.message : t.saveFail });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (card: GalleryAdminCard) => {
    const res = await galleryAdminApi.save({ ...card, enabled: !card.enabled });
    if (!res?.success) {
      toast({ title: t.saveFail, description: res?.message || t.saveFail });
      return;
    }
    await load();
  };

  const move = async (row: 1 | 2, index: number, dir: -1 | 1) => {
    const list = rows[row];
    const next = index + dir;
    if (next < 0 || next >= list.length) return;
    const ids = list.map((item) => item.id);
    const [id] = ids.splice(index, 1);
    ids.splice(next, 0, id);
    const res = await galleryAdminApi.reorder(row, ids);
    if (!res?.success) {
      toast({ title: t.saveFail, description: res?.message || t.saveFail });
      return;
    }
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{t.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">{t.sub}</p>
        </div>
        <Button
          variant="outline"
          className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          onClick={() => load()}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t.refresh}
        </Button>
      </div>
      {error ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-zinc-200">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      ) : null}
      {([1, 2] as const).map((row) => (
        <Card key={row} className="border-zinc-800 bg-zinc-900">
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-medium text-zinc-100">{t.row(row)}</h2>
              <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-300" onClick={() => openCreate(row)}>
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                {t.add}
              </Button>
            </div>
            {rows[row].length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">{loading ? t.loading : t.empty}</p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {rows[row].map((card, index) => (
                  <li key={card.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-zinc-100">{card.title}</div>
                      <div className="truncate text-xs text-zinc-500">{card.url}</div>
                      <div className="mt-1 text-xs text-zinc-400">{card.enabled ? t.enabled : t.disabled}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300" onClick={() => move(row, index, -1)} disabled={index === 0} aria-label={t.up}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300" onClick={() => move(row, index, 1)} disabled={index === rows[row].length - 1} aria-label={t.down}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300" onClick={() => toggle(card)}>
                        {card.enabled ? t.disable : t.enable}
                      </Button>
                      <Button variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-200" onClick={() => { setEditing(true); setDraft(toDraft(card)); }}>
                        {t.edit}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
      <Dialog open={!!draft} onOpenChange={(open) => { if (!open && !saving) setDraft(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t.editTitle : t.createTitle}</DialogTitle>
            <DialogDescription className="text-zinc-400">{t.dialogHint}</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm text-zinc-300 sm:col-span-2">
                {t.id}
                <Input className={fieldClass} value={draft.id} disabled={editing} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
              </label>
              <label className="block text-sm text-zinc-300">
                {t.titleField}
                <Input className={fieldClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="block text-sm text-zinc-300">
                {t.titleEn}
                <Input className={fieldClass} value={draft.titleEn} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} />
              </label>
              <label className="block text-sm text-zinc-300 sm:col-span-2">
                {t.caption}
                <Input className={fieldClass} value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} />
              </label>
              <label className="block text-sm text-zinc-300 sm:col-span-2">
                {t.captionEn}
                <Input className={fieldClass} value={draft.captionEn} onChange={(e) => setDraft({ ...draft, captionEn: e.target.value })} />
              </label>
              <label className="block text-sm text-zinc-300 sm:col-span-2">
                {t.url}
                <Input className={fieldClass} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
              </label>
              <label className="block text-sm text-zinc-300 sm:col-span-2">
                {t.href}
                <Input className={fieldClass} value={draft.href} onChange={(e) => setDraft({ ...draft, href: e.target.value })} />
              </label>
              <label className="block text-sm text-zinc-300">
                {t.preview}
                <select
                  className="mt-1 h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  value={draft.preview}
                  onChange={(e) => setDraft({ ...draft, preview: e.target.value as Preview })}
                >
                  <option value="image">image</option>
                  <option value="coffee">coffee</option>
                  <option value="www">www</option>
                  <option value="preview">preview</option>
                </select>
              </label>
              <label className="block text-sm text-zinc-300">
                {t.rowField}
                <select
                  className="mt-1 h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  value={draft.row}
                  onChange={(e) => setDraft({ ...draft, row: Number(e.target.value) === 2 ? 2 : 1 })}
                >
                  <option value={1}>{t.row(1)}</option>
                  <option value={2}>{t.row(2)}</option>
                </select>
              </label>
              <label className="block text-sm text-zinc-300 sm:col-span-2">
                {t.image}
                <Input className={fieldClass} value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                {t.show}
              </label>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="outline" className="border-zinc-700 bg-zinc-900" disabled={saving} onClick={() => setDraft(null)}>{t.cancel}</Button>
                <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-300" disabled={saving} onClick={saveDraft}>{saving ? t.saving : t.save}</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminGallery;
