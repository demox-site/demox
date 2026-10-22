import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { functionsApi, type FunctionInvocation } from "@/api";
import { useFunctionWorkspace } from "./function-context";

export function useInvocations(functionId: string, enabled: boolean, status = "all") {
  const { copy } = useFunctionWorkspace();
  const { toast } = useToast();
  const [rows, setRows] = useState<FunctionInvocation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    functionsApi.listInvocations(functionId, { limit: 100, since, status })
      .then((response) => {
        if (!cancelled) setRows(response.invocations || []);
      })
      .catch((error) => {
        if (cancelled) return;
        setRows([]);
        toast({ title: copy.invocationsFailed, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.invocationsFailed, enabled, functionId, status, toast]);

  return { rows, loading };
}
