import { useEffect, useState } from "react";
import { Button, useToast } from "@/components/ui";
import { ArrowLeft, Copy, Play } from "lucide-react";
import { useFunctionRoute, useFunctionWorkspace } from "./function-context";
import { curlSnippet, fetchSnippet, functionInvokeUrl, functionScopeId, functionStatus, FUNCTION_TABS } from "./model";
import { FunctionCode, FunctionSettings, InvocationMetrics, InvocationTable, InvocationsPanel, LogsPanel } from "./FunctionPanels";
import { useInvocations } from "./use-invocations";
import { FunctionTestSheet } from "./FunctionTestSheet";

export function FunctionDetail() {
  const { copy, projectId, items, loading, openList, reload, setTab } = useFunctionWorkspace();
  const { functionId, tab } = useFunctionRoute();
  const { toast } = useToast();
  const selected = items.find((item) => item.functionId === functionId) || null;
  const [testOpen, setTestOpen] = useState(false);
  const [snippetKind, setSnippetKind] = useState<"curl" | "fetch">("curl");
  const invocations = useInvocations(functionId, Boolean(selected) && tab === "overview");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));
      if (event.shiftKey && event.key.toLowerCase() === "t" && !typing) {
        event.preventDefault();
        setTestOpen(true);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < FUNCTION_TABS.length) setTab(FUNCTION_TABS[index]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  if (!selected) {
    return (
      <div className="min-w-0 flex-1">
        <button type="button" onClick={openList} className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          {copy.back}
        </button>
        <p className="text-sm text-muted-foreground">{loading ? copy.refresh : copy.missing}</p>
      </div>
    );
  }

  const scopeId = functionScopeId(selected, projectId);
  const url = functionInvokeUrl(scopeId, selected);
  const snippet = snippetKind === "curl" ? curlSnippet(url) : fetchSnippet(url);
  const status = functionStatus(selected);

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast({ title: copy.copied });
  };

  return (
    <div className="min-w-0 flex-1">
      <button type="button" onClick={openList} className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {copy.back}
      </button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{selected.name}</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.slug}</p>
        </div>
        <Button type="button" size="sm" onClick={() => setTestOpen(true)}>
          <Play className="mr-2 h-4 w-4" />
          {copy.test}
        </Button>
      </div>
      <div className="mt-4 flex gap-1 overflow-x-auto border-b">
        {FUNCTION_TABS.map((item, index) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`border-b-2 px-3 py-2 text-sm ${tab === item ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`}
          >
            {copy.tabs[item]}
            <span className="ml-1 text-xs text-muted-foreground">{index + 1}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "overview" ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{copy.status}</div>
                <div className="mt-1 text-sm">{status === "active" ? copy.active : copy.unpublished}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{copy.version}</div>
                <div className="mt-1 font-mono text-sm">{selected.publishedVersion ? `v${selected.publishedVersion}` : "—"}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{copy.url}</div>
                <div className="mt-1 flex items-start justify-between gap-2">
                  <span className="break-all font-mono text-xs">{url}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void copyText(url)}>
                    <Copy className="h-4 w-4" />
                    <span className="sr-only">{copy.copyUrl}</span>
                  </Button>
                </div>
              </div>
            </div>
            <InvocationMetrics functionId={selected.functionId} active />
            <section className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{copy.howToCall}</h3>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant={snippetKind === "curl" ? "default" : "outline"} onClick={() => setSnippetKind("curl")}>cURL</Button>
                  <Button type="button" size="sm" variant={snippetKind === "fetch" ? "default" : "outline"} onClick={() => setSnippetKind("fetch")}>fetch</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void copyText(snippet)}>{copy.copySnippet}</Button>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{copy.invokeHint}</p>
              <pre className="mt-3 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5">{snippet}</pre>
            </section>
            <InvocationTable rows={invocations.rows} loading={invocations.loading} />
          </div>
        ) : null}
        {tab === "invocations" ? <InvocationsPanel functionId={selected.functionId} /> : null}
        {tab === "logs" ? <LogsPanel functionId={selected.functionId} /> : null}
        {tab === "code" ? <FunctionCode selected={selected} /> : null}
        {tab === "settings" ? (
          <FunctionSettings
            selected={selected}
            onDeleted={() => {
              openList();
              void reload();
            }}
          />
        ) : null}
      </div>
      <FunctionTestSheet open={testOpen} onOpenChange={setTestOpen} selected={selected} />
    </div>
  );
}
