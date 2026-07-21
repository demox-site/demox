import React, { useEffect, useMemo, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { AuthDialog } from "@/components/AuthDialog";
import { Button } from "@/components/ui";
import { tokenManager } from "@/api";
import {
  isAllowedSiteReturnUrl,
  rememberSiteAuthHandoff,
  rememberSiteAuthNext,
  submitSiteAuthCompletion
} from "@/lib/site-auth";

function readNextUrl() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  return isAllowedSiteReturnUrl(next) ? next : "";
}

function isEmbeddedGate() {
  return new URLSearchParams(window.location.search).get("embedded") === "1";
}

function SiteGateBackdrop({ host }: { host: string }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-[-3rem] scale-105 overflow-hidden bg-[#f5f5f2] opacity-85 blur-xl dark:bg-[#101010]"
      >
        <div className="absolute -right-32 top-0 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -left-24 bottom-0 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />
        <header className="flex h-20 items-center justify-between border-b border-zinc-950/10 bg-white/70 px-[7vw] dark:border-white/10 dark:bg-zinc-900/70">
          <div className="flex items-center gap-4">
            <span className="h-9 w-9 rounded-xl bg-zinc-950 dark:bg-white/80" />
            <span className="h-4 w-28 rounded-full bg-zinc-950/70 dark:bg-white/70" />
          </div>
          <div className="hidden items-center gap-4 sm:flex">
            <span className="h-3 w-16 rounded-full bg-zinc-950/30 dark:bg-white/30" />
            <span className="h-3 w-16 rounded-full bg-zinc-950/30 dark:bg-white/30" />
            <span className="h-3 w-16 rounded-full bg-zinc-950/30 dark:bg-white/30" />
          </div>
          <span className="h-10 w-24 rounded-full bg-zinc-950 dark:bg-white/80" />
        </header>
        <main className="mx-auto mt-[10vh] w-[88vw] max-w-6xl">
          <div className="h-7 w-36 rounded-full bg-blue-500/25" />
          <div className="mt-8 h-32 w-[min(64vw,48rem)] rounded-2xl bg-zinc-950/80 dark:bg-white/75" />
          <div className="mt-7 h-16 w-[min(56vw,38rem)] rounded-xl bg-zinc-950/20 dark:bg-white/20" />
          <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-[1.1fr_.9fr]">
            <div className="h-64 rounded-[2rem] border border-zinc-950/10 bg-white/75 shadow-2xl dark:border-white/10 dark:bg-zinc-900/75" />
            <div className="hidden h-64 rounded-[2rem] border border-zinc-950/10 bg-white/75 shadow-2xl dark:border-white/10 dark:bg-zinc-900/75 sm:block" />
          </div>
        </main>
      </div>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-zinc-950/30 shadow-[inset_0_0_10rem_rgba(0,0,0,0.18)] dark:bg-black/40" />
      <div className="pointer-events-none fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 overflow-hidden rounded-full border border-white/25 bg-zinc-950/65 px-3.5 py-2 text-xs font-bold text-white/90 shadow-xl backdrop-blur-xl">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_0_.25rem_rgba(110,231,183,0.15)]" />
        <span className="truncate">{host} 是私有项目</span>
      </div>
    </>
  );
}

export function SiteAuth() {
  const nextUrl = useMemo(() => readNextUrl(), []);
  const embedded = useMemo(() => isEmbeddedGate() && Boolean(nextUrl), [nextUrl]);
  const [loginOpen, setLoginOpen] = useState(true);

  const finishSiteLogin = React.useCallback(() => {
    const token = tokenManager.get();
    return Boolean(
      embedded && nextUrl && token && submitSiteAuthCompletion(nextUrl, token)
    );
  }, [embedded, nextUrl]);

  useEffect(() => {
    if (nextUrl) {
      rememberSiteAuthNext(nextUrl);
      rememberSiteAuthHandoff(embedded);
    }
    const existingToken = tokenManager.get();
    if (nextUrl && existingToken) {
      tokenManager.set(existingToken);
      if (finishSiteLogin()) return;
      window.location.href = nextUrl;
    }
  }, [finishSiteLogin, nextUrl]);

  const host = nextUrl ? new URL(nextUrl).hostname : "this private site";

  const handleLoginSuccess = () => {
    if (finishSiteLogin()) return;
    if (nextUrl) {
      window.location.href = nextUrl;
      return;
    }
    window.location.href = "/console/projects";
  };

  if (embedded) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#f5f5f2] dark:bg-[#101010]">
        <SiteGateBackdrop host={host} />
        <AuthDialog
          isOpen
          onOpenChange={() => setLoginOpen(true)}
          onLoginSuccess={handleLoginSuccess}
          presentation="site-gate"
          title="登录后查看私有项目"
          description={`登录 Demox 以继续访问 ${host}`}
        />
      </div>
    );
  }

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
