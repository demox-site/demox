import { useEffect, useState } from "react";
import { Button, Input, Label, Textarea, useToast } from "@/components/ui";
import { Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { functionsApi } from "@/api";
import { useFunctionWorkspace } from "./function-context";
import { parseSecretText, reservedSecretKey, secretDigest } from "./model";

type Row = { key: string; value: string; digest: string };

export function FunctionSecrets() {
  const { copy, projectId } = useFunctionWorkspace();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([{ key: "", value: "", digest: "" }]);
  const [bulk, setBulk] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    functionsApi.getEnv(projectId)
      .then(async (response) => {
        if (cancelled) return;
        const entries = Object.entries(response.env || {});
        const next = await Promise.all(entries.map(async ([key, value]) => ({
          key,
          value,
          digest: await secretDigest(value)
        })));
        setRows(next.length ? next : [{ key: "", value: "", digest: "" }]);
      })
      .catch((error) => {
        if (cancelled) return;
        toast({ title: copy.secretsLoadFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.secretsLoadFailed, projectId, toast]);

  const onSave = async () => {
    const parsed = parseSecretText(bulk);
    if (parsed.invalid) {
      toast({ title: copy.secretsInvalid, description: parsed.invalid, variant: "destructive" });
      return;
    }
    const env: Record<string, string> = { ...parsed.env };
    for (const row of rows) {
      const key = row.key.trim().toUpperCase();
      if (!key) continue;
      if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) {
        toast({ title: copy.secretsInvalid, description: key, variant: "destructive" });
        return;
      }
      env[key] = row.value;
    }
    for (const key of Object.keys(env)) {
      if (reservedSecretKey(key)) {
        toast({ title: copy.secretsReserved, description: key, variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      const saved = await functionsApi.putEnv(projectId, env);
      const entries = Object.entries(saved.env || {});
      const next = await Promise.all(entries.map(async ([key, value]) => ({
        key,
        value,
        digest: await secretDigest(value)
      })));
      setRows(next.length ? next : [{ key: "", value: "", digest: "" }]);
      setBulk("");
      toast({ title: copy.secretsSaved });
    } catch (error) {
      toast({ title: copy.secretsFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{copy.secretsTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.secretsHint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setVisible((current) => !current)}>
            {visible ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
            {visible ? copy.siteEnvHide : copy.siteEnvShow}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, { key: "", value: "", digest: "" }])}>
            <Plus className="mr-2 h-4 w-4" />
            {copy.secretsAdd}
          </Button>
          <Button type="button" size="sm" onClick={() => void onSave()} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {copy.secretsSave}
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_9rem_auto] gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <span>{copy.secretsName}</span>
          <span>{copy.secretsValue}</span>
          <span>{copy.secretsDigest}</span>
          <span />
        </div>
        {loading ? <p className="px-3 py-6 text-sm text-muted-foreground">{copy.refresh}</p> : null}
        {!loading && rows.every((row) => !row.key) ? <p className="px-3 py-4 text-sm text-muted-foreground">{copy.secretsEmpty}</p> : null}
        <div className="space-y-2 p-3">
          {rows.map((row, index) => (
            <div key={`${row.key}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_9rem_auto] items-center gap-2">
              <Input
                value={row.key}
                autoComplete="off"
                className="font-mono text-sm"
                placeholder={copy.secretsName}
                onChange={(event) => {
                  const value = event.target.value;
                  setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: value } : item));
                }}
              />
              <Input
                value={row.value}
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                className="font-mono text-sm"
                placeholder={copy.secretsValue}
                onChange={(event) => {
                  const value = event.target.value;
                  setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value, digest: "" } : item));
                }}
              />
              <span className="truncate font-mono text-xs text-muted-foreground">{row.digest || "—"}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((current) => {
                  const next = current.filter((_, itemIndex) => itemIndex !== index);
                  return next.length ? next : [{ key: "", value: "", digest: "" }];
                })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <Label>{copy.secretsBulk}</Label>
        <Textarea
          className="min-h-28 font-mono text-sm"
          value={bulk}
          placeholder={'API_KEY=secret\n{"WEBHOOK_SECRET":"abc"}'}
          onChange={(event) => setBulk(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{copy.secretsBulkHint}</p>
      </div>
    </div>
  );
}
