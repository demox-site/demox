import React, { useEffect, useMemo, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { AuthDialog } from "@/components/AuthDialog";
import { Button } from "@/components/ui";
import { tokenManager } from "@/api";
import { isAllowedSiteReturnUrl, rememberSiteAuthNext } from "@/lib/site-auth";

function readNextUrl() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  return isAllowedSiteReturnUrl(next) ? next : "";
}

export function SiteAuth() {
  const nextUrl = useMemo(() => readNextUrl(), []);
  const [loginOpen, setLoginOpen] = useState(true);

  useEffect(() => {
    if (nextUrl) rememberSiteAuthNext(nextUrl);
    const existingToken = tokenManager.get();
    if (nextUrl && existingToken) {
      tokenManager.set(existingToken);
      window.location.href = nextUrl;
    }
  }, [nextUrl]);

  const host = nextUrl ? new URL(nextUrl).hostname : "this private site";

  const handleLoginSuccess = () => {
    if (nextUrl) {
      window.location.href = nextUrl;
      return;
    }
    window.location.href = "/console/projects";
  };

  return (
    <div className="min-h-screen overflow-hidden bg-black text-zinc-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-24 top-12 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-16">
        <section className="grid w-full gap-8 md:grid-cols-[1.05fr_.95fr] md:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-cyan-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Private Demox site
            </div>
            <h1 className="max-w-2xl text-5xl font-black leading-[0.95] tracking-[-0.06em] text-zinc-50 md:text-7xl">
              Sign in to cross the edge.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-zinc-400">
              <span className="font-mono text-zinc-200">{host}</span> is marked private.
              Demox checks your account before any page or asset is served.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                onClick={() => setLoginOpen(true)}
                className="bg-zinc-100 font-bold text-zinc-950 hover:bg-white"
              >
                Sign in
              </Button>
              <Button
                variant="outline"
                onClick={() => (window.location.href = "/index")}
                className="border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
              >
                Back to Demox
              </Button>
            </div>
          </div>

          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-7 shadow-2xl shadow-black/30 backdrop-blur">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
              <LockKeyhole className="h-7 w-7" />
            </div>
            <h2 className="mt-6 text-2xl font-bold tracking-tight">Access is protected</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              If your account owns this deployment, signing in will send you straight back.
              Otherwise the edge will show an access denied page.
            </p>
          </div>
        </section>
      </main>

      <AuthDialog
        isOpen={loginOpen}
        onOpenChange={setLoginOpen}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}

export default SiteAuth;
