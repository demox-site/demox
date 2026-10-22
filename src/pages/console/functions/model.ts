import { functionsApi, type SiteFunction } from "@/api";

export const FUNCTION_TABS = ["overview", "invocations", "logs", "code", "settings"] as const;
export type FunctionTab = (typeof FUNCTION_TABS)[number];

export const STATS_RANGES = ["15min", "1hr", "3hr", "1day"] as const;

const RESERVED_SECRET = /^(?:SITE_ID|FUNCTION_SLUG|PATH|NODE_PATH|NODE_OPTIONS|HOME)$/;
const RESERVED_SECRET_PREFIX = /^(?:FUNCTIONS_|DEMOX_BIZ_)/;

export function isFunctionTab(value: string | null): value is FunctionTab {
  return FUNCTION_TABS.includes(value as FunctionTab);
}

export function slugFromName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (slug.length >= 2) return slug;
  return slug ? `${slug}-fn` : "hello";
}

export function functionPublicPath(item: Pick<SiteFunction, "slug" | "routes">) {
  const route = (item.routes || [])[0];
  if (route) return route.startsWith("/") ? route : `/${route}`;
  return `/api/${String(item.slug || "").trim()}`;
}

export function functionInvokeUrl(scopeId: string, item: Pick<SiteFunction, "slug" | "routes">, alias = "production") {
  const id = String(scopeId || "").trim();
  const aliasName = String(alias || "production").trim() || "production";
  if (!id) return "";
  return `${functionsApi.baseUrl}/${encodeURIComponent(id)}/${encodeURIComponent(aliasName)}${functionPublicPath(item)}`;
}

export function functionScopeId(item: Pick<SiteFunction, "websiteId">, projectId: string) {
  return String(item.websiteId || projectId || "").trim();
}

export function functionStatus(item: SiteFunction) {
  if (item.publishedVersion) return "active";
  if (String(item.status || "").toLowerCase() === "active") return "active";
  return "unpublished";
}

export function formatUpdatedAt(value: string | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function curlSnippet(url: string) {
  return `curl -L -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  --data '{"name":"Functions"}'`;
}

export function fetchSnippet(url: string) {
  return `fetch('${url}', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Functions' })
})`;
}

export function cliSnippet(scopeId: string, slug: string) {
  const id = scopeId || "PROJECT_ID";
  const name = slug || "hello";
  return `demox functions push ./api/${name} --id ${id} --slug ${name}
demox env set --id ${id} --slug ${name} --from .env
demox functions alias set --id ${id} --slug ${name} production --version 1
demox functions invoke --id ${id} --slug ${name} --body '{}'`;
}

export function reservedSecretKey(key: string) {
  return RESERVED_SECRET.test(key) || RESERVED_SECRET_PREFIX.test(key);
}

export function parseSecretText(raw: string): { env: Record<string, string>; invalid?: string } {
  const text = raw.trim();
  if (!text) return { env: {} };
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { env: {}, invalid: "json" };
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const name = key.trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || typeof value !== "string") return { env: {}, invalid: name || "json" };
        env[name] = value;
      }
      return { env };
    } catch {
      return { env: {}, invalid: "json" };
    }
  }
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return { env: {}, invalid: trimmed };
    const name = trimmed.slice(0, eq).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) return { env: {}, invalid: name || trimmed };
    env[name] = trimmed.slice(eq + 1);
  }
  return { env };
}

export async function secretDigest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export const FUNCTION_TEMPLATES = [
  {
    id: "hello",
    source: `module.exports = async function handler(request) {
  const name = request.body && request.body.name;
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Hello " + (name || "World") })
  };
};
`
  },
  {
    id: "json",
    source: `module.exports = async function handler(request) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, method: request.method, path: request.path, body: request.body })
  };
};
`
  },
  {
    id: "webhook",
    source: `module.exports = async function handler(request, env) {
  const secret = env.WEBHOOK_SECRET || "";
  const given = (request.headers && request.headers["x-webhook-secret"]) || "";
  if (!secret || given !== secret) {
    return { status: 401, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "unauthorized" }) };
  }
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) };
};
`
  },
  {
    id: "timer",
    source: `module.exports = async function handler(request) {
  if (request.method === "TIMER") {
    return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true, trigger: request.body }) };
  }
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) };
};
`
  },
  {
    id: "proxy",
    source: `module.exports = async function handler(request, env) {
  const upstream = await fetch(env.UPSTREAM_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + (env.API_KEY || "")
    },
    body: JSON.stringify(request.body || {})
  });
  const text = await upstream.text();
  return {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    body: text
  };
};
`
  }
] as const;

export const DEFAULT_SOURCE = FUNCTION_TEMPLATES[0].source;
