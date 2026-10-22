import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast
} from "@/components/ui";
import { ChevronDown, Copy, Plus, RefreshCw, Search, Terminal } from "lucide-react";
import { useFunctionRoute, useFunctionWorkspace } from "./function-context";
import {
  cliSnippet,
  fetchSnippet,
  formatUpdatedAt,
  functionInvokeUrl,
  functionScopeId,
  functionStatus
} from "./model";

export function FunctionsHome() {
  const { copy, locale, items, loading, loadError, reload, openNew, openFunction, projectId } = useFunctionWorkspace();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [cliOpen, setCliOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.name, item.slug, item.functionId, ...(item.routes || [])].join(" ").toLowerCase().includes(needle));
  }, [items, query]);

  const example = filtered[0] || items[0];
  const exampleUrl = example ? functionInvokeUrl(functionScopeId(example, projectId), example) : functionInvokeUrl(projectId, { slug: "hello", routes: [] });
  const snippet = fetchSnippet(exampleUrl);

  const copyText = async (value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast({ title: copy.copied });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {copy.refresh}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                {copy.deploy}
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openNew}>{copy.deployEditor}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCliOpen(true)}>
                <Terminal className="mr-2 h-4 w-4" />
                {copy.deployCli}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-medium">{copy.howToCall}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{copy.invokeHint}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyText(snippet)}>
            <Copy className="mr-2 h-4 w-4" />
            {copy.copySnippet}
          </Button>
        </div>
        <pre className="mt-3 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5">{snippet}</pre>
      </div>

      {loadError ? <p className="text-sm text-muted-foreground">{loadError}</p> : null}

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{copy.nameColumn}</TableHead>
              <TableHead className="w-28">{copy.status}</TableHead>
              <TableHead>{copy.urlColumn}</TableHead>
              <TableHead className="w-24">{copy.version}</TableHead>
              <TableHead className="w-36">{copy.updatedColumn}</TableHead>
              <TableHead className="w-16 text-right">{copy.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !items.length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">{copy.refresh}</TableCell>
              </TableRow>
            ) : null}
            {filtered.map((item) => {
              const status = functionStatus(item);
              const url = functionInvokeUrl(functionScopeId(item, projectId), item);
              return (
                <TableRow key={item.functionId} className="cursor-pointer" onClick={() => openFunction(item.functionId)}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{item.slug}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={status === "active" ? "success" : "warning"}>
                      {status === "active" ? copy.active : copy.unpublished}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">{url}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.publishedVersion ? `v${item.publishedVersion}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatUpdatedAt(item.updatedAt || item.createdAt, locale)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copyText(url);
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      <span className="sr-only">{copy.copyUrl}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!loading && !filtered.length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">{copy.empty}</p>
                  <Button className="mt-4" size="sm" onClick={openNew}>
                    <Plus className="mr-2 h-4 w-4" />
                    {copy.emptyAction}
                  </Button>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">{copy.total(filtered.length)}</div>
      </div>

      <Dialog open={cliOpen} onOpenChange={setCliOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.cliTitle}</DialogTitle>
            <DialogDescription>{copy.cliHint}</DialogDescription>
          </DialogHeader>
          <pre className="overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5">{cliSnippet(projectId, example?.slug || "hello")}</pre>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyText(cliSnippet(projectId, example?.slug || "hello"))}>
            <Copy className="mr-2 h-4 w-4" />
            {copy.copySnippet}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function FunctionsSection() {
  const { copy, openList, openSecrets } = useFunctionWorkspace();
  const { panel, functionId } = useFunctionRoute();
  if (functionId) return null;
  const onSecrets = panel === "secrets";
  return (
    <nav className="flex w-full shrink-0 gap-1 sm:w-40 sm:flex-col">
      <button
        type="button"
        onClick={openList}
        className={`rounded-md px-3 py-2 text-left text-sm ${onSecrets ? "text-muted-foreground hover:bg-muted" : "bg-muted font-medium"}`}
      >
        {copy.navFunctions}
      </button>
      <button
        type="button"
        onClick={openSecrets}
        className={`rounded-md px-3 py-2 text-left text-sm ${onSecrets ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}
      >
        {copy.navSecrets}
      </button>
    </nav>
  );
}
