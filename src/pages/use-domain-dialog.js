import { useState, useEffect } from "react";
import { websiteApi } from "../api";
import { useToast } from "@/components/ui";
import { DEFAULT_OFFICIAL_DOMAIN, normalizeOfficialDomain } from "@/lib/official-domains";

/**
 * useDomainDialog
 * 自定义子域名前缀弹窗：打开、实时可用性检测（防抖 500ms）、绑定、解绑、复制。
 * @param {{ t:Record<string,any>, setWebsites:Function }} deps
 */
export function useDomainDialog({ t, setWebsites }) {
  const { toast } = useToast();
  const [domainOpen, setDomainOpen] = useState(false);
  const [domainWebsite, setDomainWebsite] = useState(null);
  const [domainInput, setDomainInput] = useState("");
  const [domainSuffix, setDomainSuffix] = useState(DEFAULT_OFFICIAL_DOMAIN);
  const [domainInfo, setDomainInfo] = useState(null); // { subdomain, domain }
  const [domainBusy, setDomainBusy] = useState(false);
  // 实时检测：status = idle | checking | ok | taken | invalid
  const [domainCheck, setDomainCheck] = useState({ status: "idle", message: "" });

  const openDomainDialog = (website) => {
    const suffix = normalizeOfficialDomain(website.subdomainDomain || website.subdomain_domain);
    setDomainWebsite(website);
    setDomainInput(website.subdomain || "");
    setDomainSuffix(suffix);
    setDomainInfo(website.subdomain ? { subdomain: website.subdomain, domain: suffix } : null);
    setDomainCheck({ status: "idle", message: "" });
    setDomainOpen(true);
  };

  /**
   * 实时检测前缀是否可用(防抖 500ms)。
   * 仅在"未设置/正在编辑"状态下生效;输入与当前已设置前缀相同则视为可用。
   */
  useEffect(() => {
    if (!domainOpen || !domainWebsite) return;
    if (domainInfo && domainInfo.subdomain) return; // 已设置态不检测
    const label = String(domainInput || "").trim().toLowerCase();
    const suffix = normalizeOfficialDomain(domainSuffix);
    if (!label) {
      setDomainCheck({ status: "idle", message: "" });
      return;
    }
    // 与当前站点已有前缀相同 → 直接可用
    const currentSuffix = normalizeOfficialDomain(domainWebsite.subdomainDomain || domainWebsite.subdomain_domain);
    if (domainWebsite.subdomain && label === domainWebsite.subdomain && suffix === currentSuffix) {
      setDomainCheck({ status: "ok", message: "" });
      return;
    }
    let cancelled = false;
    setDomainCheck({ status: "checking", message: "" });
    const timer = setTimeout(async () => {
      try {
        const r = await websiteApi.checkSubdomain({
          docId: domainWebsite._id,
          websiteId: domainWebsite.websiteId,
          subdomain: label,
          domain: suffix
        });
        if (cancelled) return;
        if (r && r.success && r.available) {
          setDomainCheck({ status: "ok", message: "" });
        } else {
          setDomainCheck({
            status: r && (r.reason === "invalid" || r.reason === "invalid_domain") ? "invalid" : "taken",
            message: (r && r.message) || ""
          });
        }
      } catch (e) {
        if (!cancelled) setDomainCheck({ status: "idle", message: "" });
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [domainInput, domainSuffix, domainOpen, domainWebsite, domainInfo]);

  /**
   * 保存自定义子域名前缀
   */
  const bindDomain = async () => {
    if (!domainWebsite) return;
    const subdomain = String(domainInput || "").trim().toLowerCase();
    const suffix = normalizeOfficialDomain(domainSuffix);
    if (!subdomain) return;
    setDomainBusy(true);
    try {
      const r = await websiteApi.setSubdomain({
        docId: domainWebsite._id,
        websiteId: domainWebsite.websiteId,
        subdomain,
        domain: suffix
      });
      if (r && r.success) {
        const label = r.subdomain || subdomain;
        const savedSuffix = normalizeOfficialDomain(r.subdomainDomain || r.subdomain_domain || suffix);
        setDomainInfo({ subdomain: label, domain: savedSuffix });
        setDomainSuffix(savedSuffix);
        setWebsites((prev) =>
          prev.map((w) =>
            w._id === domainWebsite._id ? { ...w, subdomain: label, subdomainDomain: savedSuffix } : w
          )
        );
        toast({ title: t.domainBindSuccess, description: t.domainBindSuccessDesc });
      } else if (r && (r.code === "DUPLICATE" || r.reason === "taken")) {
        // 并发冲突/已被占用:只让输入框变红,不弹 toast
        setDomainCheck({ status: "taken", message: r.message || t.domainTaken });
      } else if (r && (r.reason === "invalid" || r.reason === "invalid_domain")) {
        setDomainCheck({ status: "invalid", message: r.message || "" });
      } else {
        // 其它真实错误(网络/服务端异常)才提示
        throw new Error((r && r.message) || t.domainFailTitle);
      }
    } catch (error) {
      toast({ title: t.domainFailTitle, description: error.message, variant: "destructive" });
    } finally {
      setDomainBusy(false);
    }
  };

  /**
   * 清除自定义子域名前缀
   */
  const unbindDomain = async () => {
    if (!domainWebsite) return;
    setDomainBusy(true);
    try {
      const r = await websiteApi.clearSubdomain({
        docId: domainWebsite._id,
        websiteId: domainWebsite.websiteId
      });
      if (r && r.success) {
        setDomainInfo(null);
        setDomainInput("");
        setDomainSuffix(DEFAULT_OFFICIAL_DOMAIN);
        setWebsites((prev) =>
          prev.map((w) =>
            w._id === domainWebsite._id ? { ...w, subdomain: null, subdomainDomain: DEFAULT_OFFICIAL_DOMAIN } : w
          )
        );
        toast({ title: t.domainUnbindSuccess });
      } else {
        throw new Error((r && r.message) || t.domainFailTitle);
      }
    } catch (error) {
      toast({ title: t.domainFailTitle, description: error.message, variant: "destructive" });
    } finally {
      setDomainBusy(false);
    }
  };

  const copyCname = (text) => {
    try {
      navigator.clipboard.writeText(text);
      toast({ title: t.domainCopied });
    } catch (e) {}
  };

  return {
    domainOpen,
    setDomainOpen,
    domainInput,
    setDomainInput,
    domainSuffix,
    setDomainSuffix,
    domainInfo,
    setDomainInfo,
    domainBusy,
    domainCheck,
    openDomainDialog,
    bindDomain,
    unbindDomain,
    copyCname
  };
}
