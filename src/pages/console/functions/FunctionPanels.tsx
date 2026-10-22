import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast
} from "@/components/ui";
import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { functionsApi, type FunctionInvocation, type FunctionStats, type SiteFunction } from "@/api";
import { useFunctionWorkspace } from "./function-context";
import { formatUpdatedAt, STATS_RANGES } from "./model";
import { useInvocations } from "./use-invocations";

const DEFAULT_ALIASES = new Set(["production", "develop"]);

function sortAliases(items: Array<{ alias: string; version: number }>) {
  const rank = (name: string) => (name === "production" ? 0 : name === "develop" ? 1 : 2);
  return [...items].sort((a, b) => rank(a.alias) - rank(b.alias) || a.alias.localeCompare(b.alias));
}

export function InvocationMetrics({ functionId, active }: { functionId: string; active: boolean }) {
  const { copy } = useFunctionWorkspace();
  const [range, setRange] = useState<(typeof STATS_RANGES)[number]>("1hr");
  const [stats, setStats] = useState<FunctionStats | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    functionsApi.invocationStats(functionId, range)
      .then((response) => {
        if (!cancelled) setStats(response);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, functionId, range]);

  const max = Math.max(1, ...(stats?.series || []).map((item) => item.success + item.error));

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">{copy.metrics}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy.success} {stats?.success ?? 0} · {copy.error} {stats?.error ?? 0} · {copy.avgDuration} {stats?.avgDurationMs ?? 0} ms
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {STATS_RANGES.map((item) => (
            <Button key={item} type="button" size="sm" variant={range === item ? "default" : "outline"} onClick={() => setRange(item)}>
              {copy.ranges[item]}
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex h-24 items-end gap-1">
        {(stats?.series || []).map((point) => {
          const total = point.success + point.error;
          const height = Math.round((total / max) * 100);
          return (
            <div key={point.bucket} className="flex h-full flex-1 items-end" title={`${point.success} / ${point.error}`}>
              <div className="flex w-full flex-col justify-end" style={{ height: `${Math.max(height, total ? 8 : 0)}%` }}>
                <div className="bg-foreground/80" style={{ height: total ? `${(point.success / total) * 100}%` : 0 }} />
                <div className="bg-muted-foreground/50" style={{ height: total ? `${(point.error / total) * 100}%` : 0 }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function InvocationTable({ rows, loading }: { rows: FunctionInvocation[]; loading: boolean }) {
  const { copy, locale, setTab } = useFunctionWorkspace();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{copy.recent}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => setTab("invocations")}>{copy.openInvocations}</Button>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">{copy.refresh}</p> : null}
      {!loading && !rows.length ? <p className="text-sm text-muted-foreground">{copy.recentEmpty}</p> : null}
      {rows.length ? (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{copy.time}</th>
                <th className="px-3 py-2 font-medium">{copy.version}</th>
                <th className="px-3 py-2 font-medium">{copy.result}</th>
                <th className="px-3 py-2 font-medium">{copy.duration}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row, index) => (
                <tr key={`${row.id ?? index}-${row.createdAt}`} className="border-t">
                  <td className="px-3 py-2 text-xs">{formatUpdatedAt(row.createdAt || undefined, locale)}</td>
                  <td className="px-3 py-2 font-mono text-xs">v{row.version}</td>
                  <td className="px-3 py-2 text-xs">{row.status === "error" ? row.errorCode || copy.error : copy.success}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.durationMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function InvocationsPanel({ functionId }: { functionId: string }) {
  const { copy, locale } = useFunctionWorkspace();
  const [status, setStatus] = useState("all");
  const { rows, loading } = useInvocations(functionId, true, status);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {["all", "success", "error"].map((item) => (
          <Button key={item} type="button" size="sm" variant={status === item ? "default" : "outline"} onClick={() => setStatus(item)}>
            {item === "all" ? copy.logAll : item === "success" ? copy.success : copy.error}
          </Button>
        ))}
      </div>
      {loading ? <p className="text-sm text-muted-foreground">{copy.refresh}</p> : null}
      {!loading && !rows.length ? <p className="text-sm text-muted-foreground">{copy.invocationEmpty}</p> : null}
      {rows.length ? (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{copy.time}</th>
                <th className="px-3 py-2 font-medium">{copy.version}</th>
                <th className="px-3 py-2 font-medium">{copy.result}</th>
                <th className="px-3 py-2 font-medium">{copy.duration}</th>
                <th className="px-3 py-2 font-medium">{copy.bytes}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.id ?? index}-${row.createdAt}`} className="border-t">
                  <td className="px-3 py-2 text-xs">{formatUpdatedAt(row.createdAt || undefined, locale)}</td>
                  <td className="px-3 py-2 font-mono text-xs">v{row.version}</td>
                  <td className="px-3 py-2 text-xs">{row.status === "error" ? row.errorCode || copy.error : copy.success}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.durationMs} ms</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.requestBytes} / {row.responseBytes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function LogsPanel({ functionId }: { functionId: string }) {
  const { copy, locale } = useFunctionWorkspace();
  const { rows, loading } = useInvocations(functionId, true);
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const lines = useMemo(() => rows.map((row) => {
    const logLevel = row.status === "error" ? "error" : "info";
    const message = row.status === "error"
      ? (row.errorCode || "error")
      : `invocation completed v${row.version} ${row.durationMs}ms`;
    return { ...row, logLevel, message, time: formatUpdatedAt(row.createdAt || undefined, locale) };
  }).filter((row) => {
    if (level !== "all" && row.logLevel !== level) return false;
    if (!query.trim()) return true;
    return `${row.message} ${row.time}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [level, locale, query, rows]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{copy.logsHint}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex gap-1">
          {(["all", "info", "error"] as const).map((item) => (
            <Button key={item} type="button" size="sm" variant={level === item ? "default" : "outline"} onClick={() => setLevel(item)}>
              {item === "all" ? copy.logAll : item === "info" ? copy.logInfo : copy.logError}
            </Button>
          ))}
        </div>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.logSearch} />
      </div>
      {loading ? <p className="text-sm text-muted-foreground">{copy.refresh}</p> : null}
      {!loading && !lines.length ? <p className="text-sm text-muted-foreground">{copy.logEmpty}</p> : null}
      <div className="overflow-auto rounded-lg border bg-muted/40">
        {lines.map((row, index) => (
          <div key={`${row.id ?? index}-${row.createdAt}`} className="border-b px-3 py-2 font-mono text-xs last:border-b-0">
            <span className="text-muted-foreground">{row.time}</span>
            {"  "}
            <span>{row.logLevel}</span>
            {"  "}
            <span>{row.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FunctionCode({ selected }: { selected: SiteFunction }) {
  const { copy, reload } = useFunctionWorkspace();
  const { toast } = useToast();
  const editable = selected.editable !== false;
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    functionsApi.getSource(selected.functionId)
      .then((response) => {
        if (!cancelled) setSource(response.source);
      })
      .catch((error) => {
        if (cancelled) return;
        setSource("");
        toast({ title: copy.sourceFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.sourceFailed, selected.functionId, toast]);

  const onDeploy = async () => {
    if (!editable) return;
    setSaving(true);
    try {
      const version = await functionsApi.createVersion(selected.functionId, source);
      await functionsApi.publish(selected.functionId, version.version.version);
      await reload();
      toast({ title: copy.codeSaved, description: `v${version.version.version}` });
    } catch (error) {
      toast({ title: copy.saveFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onDownload = () => {
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selected.slug || "function"}.js`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{editable ? copy.codeDeployHint : copy.builtinCodeHint}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDownload} disabled={loading || !source}>{copy.download}</Button>
          {editable ? (
            <Button type="button" size="sm" onClick={() => void onDeploy()} disabled={saving || loading || !source.trim()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {copy.codeDeploy}
            </Button>
          ) : null}
        </div>
      </div>
      <Textarea className="min-h-[420px] font-mono text-sm" value={loading ? "" : source} disabled={loading || !editable} onChange={(event) => setSource(event.target.value)} />
    </div>
  );
}

export function FunctionSettings({ selected, onDeleted }: { selected: SiteFunction; onDeleted: () => void }) {
  const { copy, reload } = useFunctionWorkspace();
  const { toast } = useToast();
  const [name, setName] = useState(selected.name);
  const [routes, setRoutes] = useState((selected.routes || []).join(" "));
  const [timer, setTimer] = useState(selected.timerName || "");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [envVisible, setEnvVisible] = useState(false);
  const [envSaving, setEnvSaving] = useState(false);
  const [aliases, setAliases] = useState<Array<{ alias: string; version: number }>>([]);
  const [versions, setVersions] = useState<Array<{ version: number; status: string }>>([]);
  const [newAliasName, setNewAliasName] = useState("");
  const [newAliasVersion, setNewAliasVersion] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  const availableVersions = versions.filter((item) => item.status !== "failed" && item.status !== "draft");

  useEffect(() => {
    setName(selected.name);
    setRoutes((selected.routes || []).join(" "));
    setTimer(selected.timerName || "");
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    functionsApi.getFunctionEnv(selected.functionId)
      .then((response) => {
        if (cancelled) return;
        const entries = Object.entries(response.env || {});
        setEnvRows(entries.length ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]);
      })
      .catch((error) => {
        if (cancelled) return;
        toast({ title: copy.siteEnvLoadFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      });
    Promise.allSettled([functionsApi.listAliases(selected.functionId), functionsApi.listVersions(selected.functionId)])
      .then((results) => {
        if (cancelled) return;
        if (results[1].status === "fulfilled") {
          const nextVersions = results[1].value.versions || [];
          setVersions(nextVersions);
          const latest = nextVersions.find((item) => item.status !== "failed" && item.status !== "draft");
          if (latest) setNewAliasVersion(String(latest.version));
        }
        if (results[0].status === "fulfilled") setAliases(sortAliases(results[0].value.aliases || []));
        else toast({ title: copy.aliasLoadFailed, description: results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason), variant: "destructive" });
      });
    return () => {
      cancelled = true;
    };
  }, [copy.aliasLoadFailed, copy.siteEnvLoadFailed, selected.functionId, toast]);

  const onSaveEnv = async () => {
    const env: Record<string, string> = {};
    for (const row of envRows) {
      const key = row.key.trim().toUpperCase();
      if (!key) continue;
      env[key] = row.value;
    }
    setEnvSaving(true);
    try {
      const saved = await functionsApi.putFunctionEnv(selected.functionId, env);
      const entries = Object.entries(saved.env || {});
      setEnvRows(entries.length ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]);
      toast({ title: copy.siteEnvSaved });
    } catch (error) {
      toast({ title: copy.siteEnvSaveFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setEnvSaving(false);
    }
  };

  const onSetAlias = async (alias: string, version: number) => {
    setAliasSaving(true);
    try {
      const saved = await functionsApi.setAlias(selected.functionId, alias, version);
      setAliases((current) => sortAliases(current.map((item) => item.alias === saved.alias.alias ? { alias: saved.alias.alias, version: saved.alias.version } : item)));
      toast({ title: copy.aliasSaved });
    } catch (error) {
      toast({ title: copy.aliasSaveFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setAliasSaving(false);
    }
  };

  const onCreateAlias = async () => {
    const alias = newAliasName.trim().toLowerCase();
    const version = Number(newAliasVersion);
    if (!alias || !version) return;
    setAliasSaving(true);
    try {
      const saved = await functionsApi.setAlias(selected.functionId, alias, version);
      setAliases((current) => sortAliases([...current.filter((item) => item.alias !== saved.alias.alias), { alias: saved.alias.alias, version: saved.alias.version }]));
      setNewAliasName("");
      toast({ title: copy.aliasSaved });
    } catch (error) {
      toast({ title: copy.aliasCreateFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setAliasSaving(false);
    }
  };

  const onDeleteAlias = async (alias: string) => {
    if (DEFAULT_ALIASES.has(alias)) {
      toast({ title: copy.aliasReserved, variant: "destructive" });
      return;
    }
    setAliasSaving(true);
    try {
      await functionsApi.deleteAlias(selected.functionId, alias);
      setAliases((current) => current.filter((item) => item.alias !== alias));
      toast({ title: copy.aliasDeleted });
    } catch (error) {
      toast({ title: copy.aliasDeleteFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setAliasSaving(false);
    }
  };

  const onSave = async () => {
    const timerName = timer.trim();
    setSaving(true);
    try {
      await functionsApi.update(selected.functionId, {
        name: name.trim(),
        routes: routes.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
        triggers: timerName ? ["http", "timer"] : ["http"],
        timerName
      });
      await reload();
      toast({ title: copy.settingsSaved });
    } catch (error) {
      toast({ title: copy.settingsFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    try {
      await functionsApi.remove(selected.functionId);
      toast({ title: copy.deleted });
      onDeleted();
    } catch (error) {
      toast({ title: copy.deleteFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{copy.settingsName}</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{copy.slug}</Label>
          <Input value={selected.slug} disabled />
        </div>
        <div className="space-y-1.5">
          <Label>{copy.customRoutes}</Label>
          <Input value={routes} onChange={(event) => setRoutes(event.target.value)} placeholder="/webhooks/stripe" />
        </div>
        <div className="space-y-1.5">
          <Label>{copy.timerName}</Label>
          <Input value={timer} onChange={(event) => setTimer(event.target.value)} />
        </div>
      </div>
      <Button type="button" onClick={() => void onSave()} disabled={saving || !name.trim()}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {copy.settingsSave}
      </Button>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{copy.aliasTitle}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{copy.aliasHint}</p>
        </div>
        {aliases.map((item) => (
          <div key={item.alias} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
            <div className="font-mono text-xs">{item.alias}</div>
            <Select value={String(item.version)} disabled={aliasSaving || !availableVersions.length} onValueChange={(value) => void onSetAlias(item.alias, Number(value))}>
              <SelectTrigger className="h-8"><SelectValue placeholder={copy.aliasVersion} /></SelectTrigger>
              <SelectContent>
                {availableVersions.map((version) => (
                  <SelectItem key={version.version} value={String(version.version)}>v{version.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {DEFAULT_ALIASES.has(item.alias) ? <span /> : (
              <Button type="button" variant="ghost" size="sm" disabled={aliasSaving} onClick={() => void onDeleteAlias(item.alias)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
          <Input value={newAliasName} placeholder={copy.aliasName} className="h-8 font-mono text-sm" onChange={(event) => setNewAliasName(event.target.value)} />
          <Select value={newAliasVersion} disabled={!availableVersions.length} onValueChange={setNewAliasVersion}>
            <SelectTrigger className="h-8"><SelectValue placeholder={copy.aliasVersion} /></SelectTrigger>
            <SelectContent>
              {availableVersions.map((version) => (
                <SelectItem key={version.version} value={String(version.version)}>v{version.version}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" disabled={aliasSaving || !newAliasName.trim() || !newAliasVersion} onClick={() => void onCreateAlias()}>
            <Plus className="mr-1 h-4 w-4" />
            {copy.aliasAdd}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-medium">{copy.siteEnvTitle}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{copy.siteEnvHint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEnvVisible((current) => !current)}>
              {envVisible ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
              {envVisible ? copy.siteEnvHide : copy.siteEnvShow}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setEnvRows((current) => [...current, { key: "", value: "" }])}>
              <Plus className="mr-2 h-4 w-4" />
              {copy.siteEnvAdd}
            </Button>
            <Button type="button" size="sm" onClick={() => void onSaveEnv()} disabled={envSaving}>{copy.siteEnvSave}</Button>
          </div>
        </div>
        {envRows.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_minmax(0,1.4fr)_auto] gap-2">
            <Input value={row.key} placeholder={copy.siteEnvKey} className="font-mono text-sm" onChange={(event) => {
              const value = event.target.value;
              setEnvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: value } : item));
            }} />
            <Input value={row.value} type={envVisible ? "text" : "password"} placeholder={copy.siteEnvValue} className="font-mono text-sm" onChange={(event) => {
              const value = event.target.value;
              setEnvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item));
            }} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setEnvRows((current) => {
              const next = current.filter((_, itemIndex) => itemIndex !== index);
              return next.length ? next : [{ key: "", value: "" }];
            })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </section>

      <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)}>{copy.delete}</Button>
      <ConfirmDestructive
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={copy.deleteTitle}
        description={copy.deleteDesc}
        confirmLabel={copy.deleteConfirm}
        cancelLabel={copy.cancel}
        busy={deleting}
        onConfirm={onDelete}
      />
    </div>
  );
}
