import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  Button,
  Input,
  useToast
} from "@/components/ui";
import { KeyRound, Copy, Trash2, Plus, Terminal, Check, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { websiteApi } from "@/api";

const texts = {
  zh: {
    title: "访问令牌",
    subtitle: "为 CLI 与 MCP 客户端生成访问令牌，用于命令行部署与集成。",
    createTitle: "创建新令牌",
    createDesc: "令牌仅在创建时显示一次，请妥善保存。",
    namePlaceholder: "令牌名称，如 my-laptop",
    create: "生成令牌",
    creating: "生成中...",
    listTitle: "已有令牌",
    empty: "还没有任何令牌。",
    created: "创建于",
    lastUsed: "最近使用",
    never: "从未",
    revoke: "吊销",
    copy: "复制",
    copied: "已复制",
    revokeConfirm: "确定吊销此令牌？吊销后使用该令牌的 CLI/MCP 将无法部署。",
    revokeSuccess: "令牌已吊销",
    revokeFailed: "吊销失败",
    createFailed: "创建失败",
    loadFailed: "加载令牌列表失败",
    tokenOnce: "令牌已生成（仅显示一次，请立即复制保存）：",
    cliHint: "在 CLI 中使用：export DEMOX_TOKEN=<令牌>",
    loading: "加载中...",
    expired: "已过期",
    active: "有效"
  },
  en: {
    title: "Access Tokens",
    subtitle:
      "Generate tokens for the CLI and MCP clients to deploy and integrate from the command line.",
    createTitle: "Create new token",
    createDesc: "The token is shown only once at creation. Store it safely.",
    namePlaceholder: "Token name, e.g. my-laptop",
    create: "Generate token",
    creating: "Generating...",
    listTitle: "Existing tokens",
    empty: "No tokens yet.",
    created: "Created",
    lastUsed: "Last used",
    never: "Never",
    revoke: "Revoke",
    copy: "Copy",
    copied: "Copied",
    revokeConfirm: "Revoke this token? CLI/MCP clients using it will no longer be able to deploy.",
    revokeSuccess: "Token revoked",
    revokeFailed: "Revoke failed",
    createFailed: "Create failed",
    loadFailed: "Failed to load tokens",
    tokenOnce: "Token generated (shown only once — copy it now):",
    cliHint: "Use in CLI: export DEMOX_TOKEN=<token>",
    loading: "Loading...",
    expired: "Expired",
    active: "Active"
  }
} as const;

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: number | null;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revoked: boolean;
}

interface CreatedToken {
  token: string;
  name: string;
  prefix: string;
}

const TokensPage: React.FC = () => {
  const { language } = useLanguage();
  const t = texts[language];
  const { toast } = useToast();

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = useCallback(async () => {
    try {
      const res = await websiteApi.listTokens();
      if (res?.code === 0) {
        setTokens(res.data || []);
      } else {
        toast({ title: t.loadFailed, variant: "destructive" });
      }
    } catch {
      toast({ title: t.loadFailed, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, t.loadFailed]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setCreated(null);
    try {
      const res = await websiteApi.createToken(trimmed);
      if (res?.code === 0 && res.data) {
        setCreated({ token: res.data.token, name: res.data.name, prefix: res.data.prefix });
        setName("");
        await loadTokens();
      } else {
        toast({ title: t.createFailed, description: res?.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: t.createFailed, description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.confirm(t.revokeConfirm)) return;
    setRevokingId(id);
    try {
      const res = await websiteApi.revokeToken(id);
      if (res?.code === 0) {
        toast({ title: t.revokeSuccess });
        await loadTokens();
      } else {
        toast({ title: t.revokeFailed, description: res?.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: t.revokeFailed, description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setRevokingId(null);
    }
  };

  const copyToken = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: t.copied });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t.copy, variant: "destructive" });
    }
  };

  const fmt = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString(language === "zh" ? "zh-CN" : "en-US") : t.never;

  const isExpired = (row: TokenRow) =>
    row.expiresAt !== null && row.expiresAt < Date.now();

  return (
    <div className="stitch-page max-w-3xl">
      <div className="stitch-page-hero mb-8">
        <div className="stitch-eyebrow"><KeyRound className="w-4 h-4" /> {t.title}</div>
        <h1 className="stitch-title">{t.title}</h1>
        <p className="stitch-subtitle">{t.subtitle}</p>
      </div>

      {created && (
        <Card className="stitch-panel mb-6 border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              {created.name}
            </CardTitle>
            <CardDescription>{t.tokenOnce}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                readOnly
                value={created.token}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                onClick={() => copyToken(created.token)}
                className="stitch-primary rounded-full shrink-0"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {t.copy}
              </Button>
            </div>
            <p className="text-xs text-[var(--stitch-muted)] font-mono">{t.cliHint}</p>
          </CardContent>
        </Card>
      )}

      <Card className="stitch-panel mb-6">
        <CardHeader>
          <CardTitle>{t.createTitle}</CardTitle>
          <CardDescription>{t.createDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 max-w-lg">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePlaceholder}
              onKeyDown={(e) => e.key === "Enter" && !creating && handleCreate()}
              disabled={creating}
            />
            <Button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="stitch-primary rounded-full shrink-0"
            >
              <Plus className="w-4 h-4 mr-1" />
              {creating ? t.creating : t.create}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="stitch-panel">
        <CardHeader>
          <CardTitle>{t.listTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--stitch-muted)]">
              {t.loading}
            </div>
          ) : tokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Terminal className="w-10 h-10 text-[var(--stitch-muted)]/40 mb-3" />
              <p className="text-sm text-[var(--stitch-muted)]">{t.empty}</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--stitch-line)]">
              {tokens.map((tok) => {
                const expired = isExpired(tok);
                const inactive = tok.revoked || expired;
                return (
                  <div
                    key={tok.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{tok.name}</span>
                      <span className="text-xs text-[var(--stitch-muted)] font-mono">
                        {tok.prefix}••••••••
                      </span>
                      <span className="text-xs text-[var(--stitch-muted)] mt-0.5">
                        {t.created} {fmt(tok.createdAt)} · {t.lastUsed}{" "}
                        {fmt(tok.lastUsedAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                          inactive
                            ? "text-red-400 bg-red-500/10"
                            : "text-green-400 bg-green-500/10"
                        }`}
                      >
                        {tok.revoked ? t.revoke : expired ? t.expired : t.active}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToken(tok.prefix)}
                        title={t.copy}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRevoke(tok.id)}
                        disabled={tok.revoked || revokingId === tok.id}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TokensPage;
