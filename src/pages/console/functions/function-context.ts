import { createContext, useContext } from "react";
import { useSearchParams } from "react-router-dom";
import type { SiteFunction } from "@/api";
import type { FunctionCopy } from "./copy";
import { isFunctionTab, type FunctionTab } from "./model";

export type WorkspaceValue = {
  projectId: string;
  copy: FunctionCopy;
  locale: string;
  items: SiteFunction[];
  loading: boolean;
  loadError: string;
  reload: () => Promise<void>;
  openList: () => void;
  openNew: () => void;
  openSecrets: () => void;
  openFunction: (functionId: string, tab?: FunctionTab) => void;
  setTab: (tab: FunctionTab) => void;
};

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useFunctionWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Function workspace is missing");
  return value;
}

export function useFunctionRoute() {
  const [searchParams] = useSearchParams();
  const panel = searchParams.get("panel");
  const tab = searchParams.get("tab");
  return {
    panel: panel === "new" || panel === "secrets" ? panel : "",
    functionId: searchParams.get("fn") || "",
    tab: isFunctionTab(tab) ? tab : "overview" as FunctionTab
  };
}
