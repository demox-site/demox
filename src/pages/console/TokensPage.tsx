import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  Button,
  Input,
  Label,
  useToast
} from "@/components/ui";
import { KeyRound, Copy, Trash2, Plus, Terminal } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

const texts = {
  zh: {
    title: "访问令牌",
    subtitle: "为 CLI 与 MCP 客户端生成访问令牌，用于命令行部署与集成。",
    createTitle: "创建新令牌",
    createDesc: "令牌仅在创建时显示一次，请妥善保存。",
    namePlaceholder: "令牌名称，如 my-laptop",
    create: "生成令牌",
    listTitle: "已有令牌",
    empty: "还没有任何令牌。",
    created: "创建于",
    lastUsed: "最近使用",
    never: "从未",
    revoke: "吊销",
    copy: "复制",
    copied: "已复制",
    todo: "后端接口待接入"
  },
  en: {
    title: "Access Tokens",
    subtitle:
      "Generate tokens for the CLI and MCP clients to deploy and integrate from the command line.",
    createTitle: "Create new token",
    createDesc: "The token is shown only once at creation. Store it safely.",
    namePlaceholder: "Token name, e.g. my-laptop",
    create: "Generate token",
    listTitle: "Existing tokens",
    empty: "No tokens yet.",
    created: "Created",
    lastUsed: "Last used",
    never: "Never",
    revoke: "Revoke",
    copy: "Copy",
    copied: "Copied",
    todo: "Backend endpoint pending"
  }
} as const;

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const TokensPage: React.FC = () => {
  const { language } = useLanguage();
  const t = texts[language];
  const { toast } = useToast();

  // NOTE: backend endpoints (GET/POST/DELETE /auth/tokens) are not wired yet.
  const [tokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState("");

  const notImplemented = () =>
    toast({ title: t.todo, variant: "destructive" });

  const fmt = (ts: number | null) =>
    ts
      ? new Date(ts).toLocaleString(language === "zh" ? "zh-CN" : "en-US")
      : t.never;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="w-7 h-7 text-zinc-400" />
          {t.title}
        </h1>
        <p className="text-sm text-zinc-500 mt-2">{t.subtitle}</p>
      </div>

      <Card className="bg-zinc-950/50 border-zinc-900 mb-6">
        <CardHeader>
          <CardTitle className="text-zinc-100">{t.createTitle}</CardTitle>
          <CardDescription className="text-zinc-500">
            {t.createDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 max-w-lg">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePlaceholder}
              className="bg-zinc-900 border-zinc-800 text-zinc-100"
            />
            <Button
              onClick={notImplemented}
              className="shrink-0 bg-zinc-100 text-black hover:bg-white"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t.create}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-zinc-950/50 border-zinc-900">
        <CardHeader>
          <CardTitle className="text-zinc-100">{t.listTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Terminal className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">{t.empty}</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-900">
              {tokens.map((tok) => (
                <div
                  key={tok.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-zinc-100 font-medium">
                      {tok.name}
                    </span>
                    <span className="text-xs text-zinc-500 font-mono">
                      {tok.prefix}••••••••
                    </span>
                    <span className="text-xs text-zinc-600 mt-0.5">
                      {t.created} {fmt(tok.createdAt)} · {t.lastUsed}{" "}
                      {fmt(tok.lastUsedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={notImplemented}
                      className="bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={notImplemented}
                      className="bg-zinc-900 border-zinc-700 text-red-400 hover:bg-red-950/20 hover:text-red-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TokensPage;
