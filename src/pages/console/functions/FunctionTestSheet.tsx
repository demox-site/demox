import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
  useToast
} from "@/components/ui";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import { functionsApi, type SiteFunction } from "@/api";
import { useFunctionWorkspace } from "./function-context";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function FunctionTestSheet({
  open,
  onOpenChange,
  selected
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: SiteFunction;
}) {
  const { copy } = useFunctionWorkspace();
  const { toast } = useToast();
  const [method, setMethod] = useState("POST");
  const [alias, setAlias] = useState("production");
  const [queryText, setQueryText] = useState("");
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [body, setBody] = useState('{ "name": "Functions" }');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    functionsApi.listAliases(selected.functionId).then((response) => {
      if (cancelled) return;
      const names = (response.aliases || []).map((item) => item.alias);
      if (names.length && !names.includes(alias)) setAlias(names.includes("production") ? "production" : names[0]);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [alias, open, selected.functionId]);

  const onSend = async () => {
    setSending(true);
    try {
      let payload: unknown = body;
      if (method !== "GET" && method !== "HEAD") {
        try { payload = JSON.parse(body); } catch { payload = body; }
      }
      const query: Record<string, string> = {};
      for (const part of queryText.split("&")) {
        if (!part.trim()) continue;
        const [key, ...rest] = part.split("=");
        if (key) query[decodeURIComponent(key)] = decodeURIComponent(rest.join("="));
      }
      const headerMap: Record<string, string> = {};
      for (const row of headers) {
        if (row.key.trim()) headerMap[row.key.trim()] = row.value;
      }
      const invoked = await functionsApi.invoke(selected.functionId, payload, { method, alias, query, headers: headerMap });
      setResult(JSON.stringify(invoked, null, 2));
    } catch (error) {
      toast({ title: copy.testFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{copy.testTitle}</SheetTitle>
          <SheetDescription>{copy.testDesc}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{copy.testMethod}</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{copy.testAlias}</Label>
              <Input value={alias} onChange={(event) => setAlias(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{copy.testQuery}</Label>
            <Input value={queryText} placeholder="name=Demox" onChange={(event) => setQueryText(event.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{copy.testHeaders}</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setHeaders((current) => [...current, { key: "", value: "" }])}>
                <Plus className="mr-1 h-4 w-4" />
                {copy.siteEnvAdd}
              </Button>
            </div>
            {headers.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input value={row.key} placeholder={copy.headerName} onChange={(event) => {
                  const value = event.target.value;
                  setHeaders((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: value } : item));
                }} />
                <Input value={row.value} placeholder={copy.headerValue} onChange={(event) => {
                  const value = event.target.value;
                  setHeaders((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item));
                }} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setHeaders((current) => {
                  const next = current.filter((_, itemIndex) => itemIndex !== index);
                  return next.length ? next : [{ key: "", value: "" }];
                })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          {method === "GET" || method === "HEAD" ? null : (
            <div className="space-y-1.5">
              <Label>{copy.testBody}</Label>
              <Textarea className="min-h-28 font-mono text-sm" value={body} onChange={(event) => setBody(event.target.value)} />
            </div>
          )}
          <Button type="button" onClick={() => void onSend()} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {sending ? copy.testSending : copy.testSend}
          </Button>
          {result ? (
            <div>
              <div className="text-xs text-muted-foreground">{copy.testResult}</div>
              <pre className="mt-1 overflow-auto rounded-md border bg-muted p-3 text-xs">{result}</pre>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
