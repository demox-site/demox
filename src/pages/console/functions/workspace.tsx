import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { functionsApi, mapWebsiteRow, websiteApi, type SiteFunction } from "@/api";
import { useLanguage } from "@/hooks/use-language";
import { translations } from "../../home-translations";
import { useProjects } from "../../use-projects";
import { websiteMatchesProject } from "../../use-filters";
import { functionCopy } from "./copy";
import { WorkspaceContext, type WorkspaceValue } from "./function-context";

async function loadProjectFunctions(projectId: string) {
  const scopeIds = new Set<string>([projectId]);
  try {
    const response = await websiteApi.list({ projectId });
    for (const row of (response.websites || []).map(mapWebsiteRow)) {
      if (!websiteMatchesProject(row, projectId)) continue;
      const id = String(row.websiteId || row._id || "").trim();
      if (id) scopeIds.add(id);
    }
  } catch {
    // 项目级函数仍然可以加载。
  }
  const groups = await Promise.all([...scopeIds].map(async (scopeId) => {
    try {
      const listed = await functionsApi.list(scopeId);
      return listed.functions || [];
    } catch (error) {
      if (scopeId === projectId) throw error;
      return [];
    }
  }));
  const byId = new Map<string, SiteFunction>();
  for (const item of groups.flat()) {
    if (item?.functionId) byId.set(item.functionId, item);
  }
  return [...byId.values()];
}

export function FunctionWorkspace({ children }: { children: React.ReactNode }) {
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { language } = useLanguage();
  const lang = language === "en" ? "en" : "zh";
  const copy = functionCopy[lang];
  const projects = useProjects({
    t: translations[lang],
    handleAuthError: (error) => console.warn("Functions page auth error:", error)
  });
  const [items, setItems] = useState<SiteFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoadError("");
    const next = await loadProjectFunctions(projectId);
    setItems(next);
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([projects.loadProjects(), reload()])
      .catch((error) => {
        if (alive) setLoadError(error instanceof Error ? error.message : copy.loadFailed);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const writeParams = useCallback((mutate: (params: URLSearchParams) => void, replace = false) => {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    setSearchParams(params, { replace });
  }, [searchParams, setSearchParams]);

  const value = useMemo<WorkspaceValue>(() => ({
    projectId,
    copy,
    locale: lang === "en" ? "en" : "zh-CN",
    items,
    loading,
    loadError,
    reload: async () => {
      setLoading(true);
      try {
        await reload();
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : copy.loadFailed);
      } finally {
        setLoading(false);
      }
    },
    openList: () => writeParams((params) => {
      params.delete("panel");
      params.delete("fn");
      params.delete("tab");
    }),
    openNew: () => writeParams((params) => {
      params.set("panel", "new");
      params.delete("fn");
      params.delete("tab");
    }),
    openSecrets: () => writeParams((params) => {
      params.set("panel", "secrets");
      params.delete("fn");
      params.delete("tab");
    }),
    openFunction: (functionId, tab = "overview") => writeParams((params) => {
      params.delete("panel");
      params.set("fn", functionId);
      params.set("tab", tab);
    }),
    setTab: (tab) => writeParams((params) => {
      params.set("tab", tab);
    }, true)
  }), [copy, items, lang, loadError, loading, projectId, reload, writeParams]);

  const currentProject = projects.getProjectById(projectId) || null;
  const missingProject =
    projectId &&
    !projects.loadingProjects &&
    projects.activeProjects.length > 0 &&
    !currentProject;
  if (missingProject) return <Navigate to="/console/projects" replace />;

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
