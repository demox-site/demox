import { useState } from "react";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Textarea,
  useToast
} from "@/components/ui";
import { ChevronDown, Loader2 } from "lucide-react";
import { functionsApi } from "@/api";
import { useFunctionWorkspace } from "./function-context";
import { DEFAULT_SOURCE, FUNCTION_TEMPLATES, functionInvokeUrl, slugFromName } from "./model";

export function FunctionDeploy() {
  const { copy, projectId, openFunction, reload } = useFunctionWorkspace();
  const { toast } = useToast();
  const [name, setName] = useState("hello");
  const [slug, setSlug] = useState("hello");
  const [slugTouched, setSlugTouched] = useState(false);
  const [templateId, setTemplateId] = useState<string>(FUNCTION_TEMPLATES[0].id);
  const [source, setSource] = useState<string>(DEFAULT_SOURCE);
  const [createRoutes, setCreateRoutes] = useState("");
  const [createTimer, setCreateTimer] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);

  const previewPath = createRoutes.trim().split(/[\s,]+/).filter(Boolean)[0];
  const previewUrl = functionInvokeUrl(projectId, {
    slug: slug || "hello",
    routes: previewPath ? [previewPath] : []
  });

  const onCreate = async () => {
    const websiteId = projectId;
    const routes = createRoutes.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    const timerName = createTimer.trim();
    setCreating(true);
    try {
      const created = await functionsApi.create(websiteId, name, slug, {
        runtime: "nodejs",
        routes,
        triggers: timerName ? ["http", "timer"] : ["http"],
        timerName: timerName || undefined
      });
      const version = await functionsApi.createVersion(created.function.functionId, source);
      await functionsApi.publish(created.function.functionId, version.version.version);
      await reload();
      toast({ title: copy.deployed, description: `v${version.version.version}` });
      openFunction(created.function.functionId, "overview");
    } catch (error) {
      toast({ title: copy.deployFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <h2 className="text-lg font-semibold">{copy.createTitle}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.createDesc}</p>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{copy.name}</Label>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugFromName(event.target.value));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{copy.slug}</Label>
            <Input
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value.trim().toLowerCase());
              }}
            />
          </div>
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">{previewUrl}</p>
        <div className="space-y-2">
          <Label>{copy.template}</Label>
          <div className="flex flex-wrap gap-2">
            {FUNCTION_TEMPLATES.map((template) => (
              <Button
                key={template.id}
                type="button"
                size="sm"
                variant={templateId === template.id ? "default" : "outline"}
                onClick={() => {
                  setTemplateId(template.id);
                  setSource(template.source);
                }}
              >
                {copy.templates[template.id]}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{copy.source}</Label>
          <Textarea className="min-h-[420px] font-mono text-sm" value={source} onChange={(event) => setSource(event.target.value)} />
          <p className="text-xs text-muted-foreground">{copy.nodejsHint}</p>
        </div>
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ChevronDown className={`h-4 w-4 transition-transform ${advanced ? "rotate-0" : "-rotate-90"}`} />
            {copy.advanced}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-3">
            <div className="space-y-1.5">
              <Label>{copy.customRoutes}</Label>
              <Input value={createRoutes} onChange={(event) => setCreateRoutes(event.target.value)} placeholder="/webhooks/stripe" />
              <p className="text-xs text-muted-foreground">{copy.customRoutesHint}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{copy.timerName}</Label>
              <Input value={createTimer} onChange={(event) => setCreateTimer(event.target.value)} />
              <p className="text-xs text-muted-foreground">{copy.timerHint}</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
        <div>
          <Button onClick={() => void onCreate()} disabled={creating || !projectId || slug.trim().length < 2 || !source.trim()}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {creating ? copy.deploying : copy.deployButton}
          </Button>
        </div>
      </div>
    </div>
  );
}
