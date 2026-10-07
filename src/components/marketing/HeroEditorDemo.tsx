import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pencil, RotateCcw } from "lucide-react";
import {
  buildCoffeePreviewDoc,
  COFFEE_LIVE_URL,
  DEMO_HTML_FULL,
  DEMO_HTML_LINES,
} from "./coffeePreviewDoc";
import type { Language } from "@/hooks/use-language";

type Phase = "typing" | "deploying" | "live" | "editing";

const ABORT = Symbol("abort");

function sleep(ms: number, gen: { current: number }, myGen: number) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      if (gen.current !== myGen) reject(ABORT);
      else resolve();
    }, ms);
  });
}

function charDelay(c: string, fast: boolean) {
  if (c === " ") return 8;
  if (/[\u4e00-\u9fff，。·]/.test(c)) return 36 + Math.random() * 26;
  return fast ? 7 + Math.random() * 6 : 11 + Math.random() * 13;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tokenize(line: string): Array<[string, string]> {
  const t: Array<[string, string]> = [];
  let i = 0;
  const n = line.length;
  const push = (s: string, c: string) => {
    if (s) t.push([s, c]);
  };
  while (i < n) {
    if (line[i] === "<" && line[i + 1] === "!") {
      const j = line.indexOf(">", i);
      const e = j < 0 ? n : j + 1;
      push(line.slice(i, e), "cm");
      i = e;
      continue;
    }
    if (line[i] === "<") {
      let a = i + 1;
      if (line[a] === "/") a++;
      push(line.slice(i, a), "pn");
      let k = a;
      while (k < n && /[a-zA-Z0-9]/.test(line[k])) k++;
      push(line.slice(a, k), "tg");
      i = k;
      while (i < n && line[i] !== ">") {
        const ch = line[i];
        if (ch === " ") {
          push(" ", "tx");
          i++;
          continue;
        }
        if (ch === '"') {
          let q = line.indexOf('"', i + 1);
          q = q < 0 ? n : q + 1;
          push(line.slice(i, q), "st");
          i = q;
          continue;
        }
        if (ch === "=" || ch === "/") {
          push(ch, "pn");
          i++;
          continue;
        }
        let k2 = i;
        while (k2 < n && /[a-zA-Z-]/.test(line[k2])) k2++;
        if (k2 === i) k2 = i + 1;
        push(line.slice(i, k2), "at");
        i = k2;
      }
      if (line[i] === ">") {
        push(">", "pn");
        i++;
      }
      continue;
    }
    let j2 = line.indexOf("<", i);
    if (j2 < 0) j2 = n;
    push(line.slice(i, j2), "tx");
    i = j2;
  }
  return t;
}

function highlightLine(line: string) {
  return tokenize(line)
    .map(([s, c]) => `<span class="mh-${c}">${esc(s)}</span>`)
    .join("");
}

const copy = {
  zh: {
    hint: "点击编辑器，自己写一段",
    hintShort: "点击自己写一段",
    editing: "编辑中",
    resume: "继续演示",
    resumeWarn: "放弃修改？再点一次",
    preview: "预览",
    deploying: "部署中",
    live: "已上线",
    liveNode: "已部署",
    previewNode: "实时预览",
    deployNode: "demox deploy",
    urlLocal: "localhost:5173",
    urlDeploying: "正在部署…",
    aiTag: "AI 生成",
    ariaEditor: "代码编辑器与实时预览",
    ariaTa: "代码编辑器：写 HTML，右侧实时预览",
    help: "Tab 键插入两个空格，Shift+Tab 减少缩进，Esc 键离开编辑框。停止输入约 0.3 秒后右侧预览更新。",
    termReady: "VITE ready · localhost:5173 · 热更新已开启",
    termUpdated: "index.html 已更新 · 右侧实时预览",
    bundling: "打包资源...",
    bundlingDone: "完成 (0.4s)",
    uploading: "上传至边缘网络...",
    uploadingDone: "完成 (1.2s)",
    success: "成功！已部署至：",
    iframeTitle: "你的代码 · 实时预览",
  },
  en: {
    hint: "Click the editor to write your own",
    hintShort: "Click to edit",
    editing: "Editing",
    resume: "Resume demo",
    resumeWarn: "Discard edits? Click again",
    preview: "Preview",
    deploying: "Deploying",
    live: "Live",
    liveNode: "Deployed",
    previewNode: "Live preview",
    deployNode: "demox deploy",
    urlLocal: "localhost:5173",
    urlDeploying: "Deploying…",
    aiTag: "AI-generated",
    ariaEditor: "Code editor and live preview",
    ariaTa: "Code editor: write HTML, live preview on the right",
    help: "Tab inserts two spaces, Shift+Tab outdents, Esc leaves the editor. Preview updates ~0.3s after you stop typing.",
    termReady: "VITE ready · localhost:5173 · HMR on",
    termUpdated: "index.html updated · live preview",
    bundling: "Bundling assets...",
    bundlingDone: "Done (0.4s)",
    uploading: "Uploading to Edge Network...",
    uploadingDone: "Done (1.2s)",
    success: "Success! Deployed to:",
    iframeTitle: "Your code · live preview",
  },
};

interface Props {
  language: Language;
}

export const HeroEditorDemo: React.FC<Props> = ({ language }) => {
  const t = copy[language] ?? copy.zh;
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [phase, setPhase] = useState<Phase>(reduceMotion ? "live" : "typing");
  const [typedLens, setTypedLens] = useState<number[]>(() =>
    DEMO_HTML_LINES.map((l) => (reduceMotion ? l.code.length : 0))
  );
  const [curLine, setCurLine] = useState(0);
  const [termRows, setTermRows] = useState<string[]>([]);
  const [urlText, setUrlText] = useState(t.urlLocal);
  const [stateTag, setStateTag] = useState(t.preview);
  const [nodeLabel, setNodeLabel] = useState(t.previewNode);
  const [editValue, setEditValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [resumeWarn, setResumeWarn] = useState(false);
  const [previewSrc, setPreviewSrc] = useState("");
  const [charge, setCharge] = useState(reduceMotion ? 1 : 0);
  const [visibleBlocks, setVisibleBlocks] = useState<Record<string, string>>(
    () => {
      if (!reduceMotion) return {};
      const m: Record<string, string> = {};
      DEMO_HTML_LINES.forEach((l) => {
        if (l.block) {
          const open = l.code.indexOf(">");
          const close = l.code.lastIndexOf("</");
          if (open >= 0 && close > open) m[l.block] = l.code.slice(open + 1, close);
          else m[l.block] = "";
        }
      });
      return m;
    }
  );

  const gen = useRef(0);
  const baseText = useRef("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const previewTimer = useRef<number>(0);
  const idleTimer = useRef<number>(0);
  const warnTimer = useRef<number>(0);
  const codeScrollRef = useRef<HTMLDivElement>(null);

  const TOK = useMemo(
    () => DEMO_HTML_LINES.map((l) => tokenize(l.code)),
    []
  );

  const applyPhaseChrome = useCallback(
    (p: Phase) => {
      if (p === "typing" || p === "editing") {
        setUrlText(t.urlLocal);
        setStateTag(t.preview);
        setNodeLabel(p === "editing" ? t.previewNode : t.previewNode);
      } else if (p === "deploying") {
        setUrlText(t.urlDeploying);
        setStateTag(t.deploying);
        setNodeLabel(t.deployNode);
      } else if (p === "live") {
        setUrlText(COFFEE_LIVE_URL);
        setStateTag(t.live);
        setNodeLabel(t.liveNode);
      }
    },
    [t]
  );

  const syncBlocksFromTyped = useCallback((lens: number[]) => {
    const m: Record<string, string> = {};
    DEMO_HTML_LINES.forEach((l, i) => {
      if (!l.block) return;
      const n = lens[i];
      const s = l.code;
      if (l.revealAt != null) {
        if (n >= l.revealAt) m[l.block] = "";
        return;
      }
      const open = s.indexOf(">");
      const close = s.lastIndexOf("</");
      if (open >= 0 && close > open) {
        if (n > open) m[l.block] = s.slice(open + 1, Math.min(n, close));
      } else if (n >= s.length) {
        m[l.block] = "";
      }
    });
    setVisibleBlocks(m);
  }, []);

  const promptHtml = useMemo(
    () =>
      `<span class="mh-ok">➜</span> <span class="mh-dim">~/coffee $</span> `,
    []
  );

  useEffect(() => {
    if (codeScrollRef.current && curLine >= 0) {
      const el = codeScrollRef.current.querySelector(`[data-line="${curLine}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [curLine, typedLens]);

  const enterEdit = useCallback(() => {
    if (phase === "editing") return;
    gen.current++;
    const last = typedLens.reduce(
      (acc, n, i) => (n > 0 ? i : acc),
      -1
    );
    const rows: string[] = [];
    for (let j = 0; j <= Math.max(0, last); j++) {
      rows.push(DEMO_HTML_LINES[j].code.slice(0, typedLens[j]));
    }
    const text = rows.join("\n") || DEMO_HTML_FULL;
    baseText.current = text;
    setEditValue(text);
    setDirty(false);
    setResumeWarn(false);
    setPhase("editing");
    applyPhaseChrome("editing");
    setCharge(1);
    setTermRows([
      `${promptHtml}<span class="mh-w">npm run dev</span>`,
      `<span class="mh-dim">${t.termReady}</span>`,
    ]);
    setPreviewSrc(buildCoffeePreviewDoc(text));
    requestAnimationFrame(() => {
      taRef.current?.focus({ preventScroll: true });
      const len = text.length;
      taRef.current?.setSelectionRange(len, len);
    });
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      exitEditRef.current(true);
    }, 20000);
  }, [phase, typedLens, applyPhaseChrome, promptHtml, t]);

  const [restartKey, setRestartKey] = useState(0);
  const exitEditRef = useRef<(auto: boolean) => void>(() => {});

  const exitEdit = useCallback(
    (auto: boolean) => {
      window.clearTimeout(previewTimer.current);
      window.clearTimeout(idleTimer.current);
      window.clearTimeout(warnTimer.current);
      setResumeWarn(false);
      setDirty(false);
      setEditValue("");
      setPreviewSrc("");
      setPhase(reduceMotion ? "live" : "typing");
      gen.current++;
      setRestartKey((k) => k + 1);
    },
    [reduceMotion]
  );
  exitEditRef.current = exitEdit;

  const onEditInput = (v: string) => {
    setEditValue(v);
    setDirty(v !== baseText.current);
    setResumeWarn(false);
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      setPreviewSrc(buildCoffeePreviewDoc(v));
      setTermRows([
        `${promptHtml}<span class="mh-w">npm run dev</span>`,
        `<span class="mh-ok">✓</span> <span class="mh-w">${t.termUpdated}</span>`,
      ]);
    }, 300);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (v === baseText.current) exitEditRef.current(true);
    }, 20000);
  };

  const onResume = () => {
    if (dirty && !resumeWarn) {
      setResumeWarn(true);
      window.clearTimeout(warnTimer.current);
      warnTimer.current = window.setTimeout(() => setResumeWarn(false), 3500);
      return;
    }
    exitEdit(false);
  };

  const onTaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      if (e.shiftKey) {
        const v = ta.value;
        const a = ta.selectionStart;
        const ls = v.lastIndexOf("\n", a - 1) + 1;
        let n = 0;
        while (n < 2 && v[ls + n] === " ") n++;
        if (!n) return;
        const nv = v.slice(0, ls) + v.slice(ls + n);
        onEditInput(nv);
        requestAnimationFrame(() => {
          ta.setSelectionRange(Math.max(ls, a - n), Math.max(ls, a - n));
        });
      } else {
        const a = ta.selectionStart;
        const b = ta.selectionEnd;
        const nv = ta.value.slice(0, a) + "  " + ta.value.slice(b);
        onEditInput(nv);
        requestAnimationFrame(() => ta.setSelectionRange(a + 2, a + 2));
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
    }
  };

  useEffect(() => {
    if (!reduceMotion) return;
    setTypedLens(DEMO_HTML_LINES.map((l) => l.code.length));
    syncBlocksFromTyped(DEMO_HTML_LINES.map((l) => l.code.length));
    setCharge(1);
    setPhase("live");
    applyPhaseChrome("live");
    setTermRows([
      `${promptHtml}<span class="mh-w">demox deploy ./dist</span>`,
      `<span class="mh-dim">${t.uploading}</span> ${t.uploadingDone}`,
      `<span class="mh-ok">✓ ${t.success}</span><span class="mh-w">coffee.demox.site</span>`,
    ]);
  }, [reduceMotion, language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autoplay loop (restarts via restartKey after edit)
  useEffect(() => {
    if (reduceMotion) return;

    let cancelled = false;
    const myGen = ++gen.current;

    const run = async () => {
      try {
        while (!cancelled && gen.current === myGen) {
          const zeros = DEMO_HTML_LINES.map(() => 0);
          setTypedLens(zeros);
          setVisibleBlocks({});
          setCurLine(0);
          setCharge(0);
          setPhase("typing");
          applyPhaseChrome("typing");
          setTermRows([
            `${promptHtml}<span class="mh-w">npm run dev</span>`,
            `<span class="mh-dim">${t.termReady}</span>`,
          ]);

          const lens = [...zeros];
          for (let i = 0; i < DEMO_HTML_LINES.length; i++) {
            if (gen.current !== myGen) throw ABORT;
            setCurLine(i);
            const s = DEMO_HTML_LINES[i].code;
            const fast = !DEMO_HTML_LINES[i].block;
            while (lens[i] < s.length) {
              await sleep(charDelay(s[lens[i]], fast), gen, myGen);
              lens[i]++;
              setTypedLens([...lens]);
              syncBlocksFromTyped(lens);
            }
            setCharge((i + 1) / DEMO_HTML_LINES.length);
            await sleep(DEMO_HTML_LINES[i].block ? 130 : 40, gen, myGen);
          }

          setCurLine(-1);
          const cmd = "demox deploy ./dist";
          for (let k = 1; k <= cmd.length; k++) {
            setTermRows([
              `${promptHtml}<span class="mh-w">${esc(cmd.slice(0, k))}</span><i class="mh-caret"></i>`,
            ]);
            await sleep(18 + Math.random() * 22, gen, myGen);
          }
          await sleep(160, gen, myGen);
          setPhase("deploying");
          applyPhaseChrome("deploying");
          const head = `${promptHtml}<span class="mh-w">${esc(cmd)}</span>`;
          setTermRows([head, `<span class="mh-dim">${t.bundling}</span>`]);
          await sleep(520, gen, myGen);
          setTermRows([
            head,
            `<span class="mh-dim">${t.bundling}</span> ${t.bundlingDone}`,
            `<span class="mh-dim">${t.uploading}</span>`,
          ]);
          await sleep(820, gen, myGen);
          setTermRows([
            head,
            `<span class="mh-dim">${t.uploading}</span> ${t.uploadingDone}`,
            `<span class="mh-ok">✓ ${t.success}</span><span class="mh-w">coffee.demox.site</span>`,
          ]);
          setPhase("live");
          applyPhaseChrome("live");
          setCharge(1);
          await sleep(2800, gen, myGen);

          setPhase("typing");
          applyPhaseChrome("typing");
          setCharge(0);
          for (let i = DEMO_HTML_LINES.length - 1; i >= 0; i--) {
            lens[i] = 0;
            setTypedLens([...lens]);
            syncBlocksFromTyped(lens);
            await sleep(22, gen, myGen);
          }
          await sleep(60, gen, myGen);
        }
      } catch (e) {
        if (e !== ABORT) console.error(e);
      }
    };

    run();
    return () => {
      cancelled = true;
      gen.current++;
    };
  }, [restartKey, reduceMotion, language]); // eslint-disable-line react-hooks/exhaustive-deps

  const isEditing = phase === "editing";
  const showMockPage = !isEditing;
  const showLiveChrome = phase === "live" || (phase === "typing" && charge > 0.99);

  const hlHtml = useMemo(() => {
    if (!isEditing) return "";
    return (
      editValue
        .split("\n")
        .map((line) => highlightLine(line))
        .join("\n") + "\n "
    );
  }, [editValue, isEditing]);

  const gutText = useMemo(() => {
    if (!isEditing) return "";
    const n = editValue.split("\n").length;
    return Array.from({ length: n }, (_, i) => String(i + 1)).join("\n") + "\n";
  }, [editValue, isEditing]);

  return (
    <section
      className="mh-stage"
      aria-label={t.ariaEditor}
      data-phase={phase}
      style={{ ["--mh-charge" as string]: charge.toFixed(3) }}
    >
      {/* Editor */}
      <div className="mh-tilt mh-tilt-l">
        <div className="mh-panel mh-editor">
          <div className="mh-ed-bar">
            <div className="mh-dots" aria-hidden="true">
              <i /><i /><i />
            </div>
            <div className="mh-tab">
              <b />
              index.html
            </div>
            {!isEditing && (
              <button
                type="button"
                className="mh-hint"
                onClick={enterEdit}
              >
                <Pencil size={11} />
                <span className="mh-hf">{t.hint}</span>
                <span className="mh-hs">{t.hintShort}</span>
              </button>
            )}
            {isEditing && (
              <>
                <span className="mh-chip" role="status">
                  <i aria-hidden="true" />
                  {t.editing}
                </span>
                <button type="button" className={`mh-resume${resumeWarn ? " warn" : ""}`} onClick={onResume}>
                  <RotateCcw size={11} />
                  <span>{resumeWarn ? t.resumeWarn : t.resume}</span>
                </button>
              </>
            )}
            <span className="mh-ed-tag" aria-hidden="true">
              {t.aiTag}
            </span>
          </div>

          <div
            className="mh-code"
            ref={codeScrollRef}
            onClick={!isEditing ? enterEdit : undefined}
            role={!isEditing ? "button" : undefined}
            tabIndex={!isEditing ? 0 : undefined}
            onKeyDown={
              !isEditing
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      enterEdit();
                    }
                  }
                : undefined
            }
          >
            {!isEditing && (
              <div className="mh-lines">
                {DEMO_HTML_LINES.map((l, i) => {
                  const n = typedLens[i];
                  if (n <= 0 && curLine !== i) return null;
                  let out = "";
                  let used = 0;
                  for (let k = 0; k < TOK[i].length && used < n; k++) {
                    const [tk, cls] = TOK[i][k];
                    const take = Math.min(tk.length, n - used);
                    out += `<span class="mh-${cls}">${esc(tk.slice(0, take))}</span>`;
                    used += take;
                  }
                  if (curLine === i) out += '<i class="mh-caret"></i>';
                  return (
                    <div
                      key={i}
                      data-line={i}
                      className={`mh-ln${curLine === i ? " cur" : ""}`}
                      data-b={l.block || undefined}
                    >
                      <span className="mh-no">{i + 1}</span>
                      <span
                        className="mh-src"
                        dangerouslySetInnerHTML={{ __html: out }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {isEditing && (
              <div className="mh-live">
                <div className="mh-gut" aria-hidden="true">
                  <pre>{gutText}</pre>
                </div>
                <div className="mh-hlw" aria-hidden="true">
                  <pre
                    className="mh-pre"
                    dangerouslySetInnerHTML={{ __html: hlHtml }}
                  />
                </div>
                <textarea
                  ref={taRef}
                  className="mh-ta"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  wrap="off"
                  aria-label={t.ariaTa}
                  aria-describedby="mh-s1-help"
                  value={editValue}
                  onChange={(e) => onEditInput(e.target.value)}
                  onKeyDown={onTaKeyDown}
                />
                <p className="sr-only" id="mh-s1-help">
                  {t.help}
                </p>
              </div>
            )}
          </div>

          <div
            className="mh-term"
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html: termRows.map((r) => `<div class="mh-row">${r}</div>`).join(""),
            }}
          />
        </div>
      </div>

      {/* Connector node */}
      <div className="mh-link" aria-hidden="true">
        <div className="mh-node">
          <div className="mh-mark">
            <span className="mh-ring" />
            <svg className="mh-mk" viewBox="0 0 16 16" aria-hidden="true">
              <rect width="16" height="16" rx="2" fill="#111" />
              <path
                d="M8 13.9L2.763 8.349A3.35 3.35 0 1 1 8 4.211A3.35 3.35 0 1 1 13.237 8.349Z"
                fill="#fff"
              />
            </svg>
          </div>
          <div className="mh-node-label">{nodeLabel}</div>
        </div>
      </div>

      {/* Browser */}
      <div className="mh-tilt mh-tilt-r">
        <div className="mh-panel mh-browser">
          <div className="mh-chrome" aria-hidden="true">
            <div className="mh-dots">
              <i /><i /><i />
            </div>
            <div className="mh-url">
              <svg
                className="mh-lock"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
              >
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <span className="mh-ut">{urlText}</span>
            </div>
            <span className="mh-state">{stateTag}</span>
          </div>

          {showMockPage && (
            <div className={`mh-page${phase === "live" ? " is-live" : ""}`}>
              {"nav" in visibleBlocks && (
                <div className="mh-box mh-s-nav">
                  <b>
                    Coffee<span className="mh-dt">.</span>
                  </b>
                  <em>菜单</em>
                  <em>门店</em>
                  <em className="mh-pl">预订</em>
                </div>
              )}
              <div className="mh-s-hero">
                <div className="mh-s-copy">
                  {"ey" in visibleBlocks && (
                    <div className="mh-box mh-s-ey">手冲咖啡馆 · 每日现烘</div>
                  )}
                  {"h1" in visibleBlocks && (
                    <div className="mh-box mh-s-h1">
                      好咖啡，
                      <br />
                      <span className="mh-sf">慢慢来</span>
                    </div>
                  )}
                  {"p" in visibleBlocks && (
                    <div className="mh-box mh-s-p">
                      {visibleBlocks.p || "每天清晨现烘，一杯一杯手冲。"}
                    </div>
                  )}
                  {"btn" in visibleBlocks && (
                    <div className="mh-box mh-s-btn">预订座位</div>
                  )}
                </div>
                {"cover" in visibleBlocks && (
                  <div className="mh-box mh-s-cover" aria-hidden="true">
                    <i className="mh-cup" />
                    <i className="mh-hd" />
                    <i className="mh-sm" />
                    <i className="mh-sm mh-b" />
                  </div>
                )}
              </div>
              <div className="mh-s-cards">
                {"c1" in visibleBlocks && (
                  <div className="mh-box mh-s-card">云南日晒</div>
                )}
                {"c2" in visibleBlocks && (
                  <div className="mh-box mh-s-card">埃塞俄比亚水洗</div>
                )}
                {"c3" in visibleBlocks && (
                  <div className="mh-box mh-s-card">哥伦比亚蜜处理</div>
                )}
              </div>
              {"foot" in visibleBlocks && (
                <div className="mh-box mh-s-foot">© 2026 Coffee.</div>
              )}
              {showLiveChrome && (
                <a
                  className="mh-live-badge"
                  href={COFFEE_LIVE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  coffee.demox.site ↗
                </a>
              )}
            </div>
          )}

          {isEditing && (
            <div className="mh-out">
              {previewSrc && (
                <iframe
                  key={previewSrc.slice(0, 80)}
                  className="mh-frame"
                  sandbox="allow-scripts"
                  title={t.iframeTitle}
                  tabIndex={-1}
                  referrerPolicy="no-referrer"
                  srcDoc={previewSrc}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default HeroEditorDemo;
