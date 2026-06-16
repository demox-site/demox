import JSZip from "jszip";

const sourceMessages = {
  zh: {
    title: "请上传构建产物",
    source:
      "检测到你上传的是前端源码项目，而不是静态构建产物。请先在本地运行 npm install && npm run build，然后上传 dist.zip / build.zip / out.zip，不要上传 package.json、src/ 或 node_modules。",
    nodeModules:
      "检测到压缩包里包含 node_modules。请不要上传依赖目录，只上传构建后的 dist/build/out 目录。",
    missingIndex:
      "ZIP 根目录必须包含 index.html。如果这是前端项目，请先运行 npm run build，然后上传构建输出目录。",
    missingAssets:
      "检测到 index.html 引用了不存在的 JS/CSS 文件。请上传完整构建产物目录，而不是只上传部分文件。",
    invalidZip: "无法读取这个 ZIP 文件，请检查文件是否损坏。"
  },
  en: {
    title: "Upload build artifacts",
    source:
      "This looks like a frontend source project, not static build artifacts. Run npm install && npm run build locally, then upload dist.zip / build.zip / out.zip. Do not upload package.json, src/, or node_modules.",
    nodeModules:
      "The archive contains node_modules. Do not upload dependencies; upload only the built dist/build/out directory.",
    missingIndex:
      "The ZIP root must contain index.html. If this is a frontend project, run npm run build and upload the output directory.",
    missingAssets:
      "index.html references missing JS/CSS files. Upload the complete build output directory, not partial files.",
    invalidZip: "Could not read this ZIP file. Please check whether it is corrupted."
  }
};

function safeLocale(lang) {
  return lang === "en" ? "en" : "zh";
}

function safeName(name) {
  return String(name || "").replace(/\\/g, "/");
}

function isIgnored(name) {
  return (
    !name ||
    name.startsWith("/") ||
    name.includes("..") ||
    name.includes("__MACOSX") ||
    name.includes(".DS_Store")
  );
}

function normalizeEntries(zip) {
  const files = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => safeName(entry.name))
    .filter((name) => !isIgnored(name));

  let commonPrefix = "";
  if (files.length > 0) {
    const parts = files[0].split("/");
    if (parts.length > 1) {
      const candidate = `${parts[0]}/`;
      if (files.every((name) => name.startsWith(candidate))) {
        commonPrefix = candidate;
      }
    }
  }

  return files
    .map((originalName) => {
      const name =
        commonPrefix && originalName.startsWith(commonPrefix)
          ? originalName.slice(commonPrefix.length)
          : originalName;
      return { originalName, name, lowerName: name.toLowerCase() };
    })
    .filter((entry) => entry.name);
}

function isSpecialUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("#")) return true;
  return (
    /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw) ||
    /^(?:data|mailto|tel|javascript|blob):/i.test(raw)
  );
}

function stripUrlNoise(value) {
  try {
    return decodeURIComponent(String(value || "").split("#")[0].split("?")[0]);
  } catch {
    return String(value || "").split("#")[0].split("?")[0];
  }
}

function normalizeHtmlRef(ref, htmlPath) {
  if (isSpecialUrl(ref)) return "";
  const cleaned = stripUrlNoise(ref).trim();
  if (!cleaned || cleaned.startsWith("#")) return "";
  const baseDir = htmlPath.includes("/")
    ? htmlPath.split("/").slice(0, -1).join("/")
    : "";
  const joined = cleaned.startsWith("/")
    ? cleaned.slice(1)
    : baseDir
      ? `${baseDir}/${cleaned}`
      : cleaned;
  const parts = [];
  for (const part of joined.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function extractAssetRefs(html) {
  const refs = [];
  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = scriptRe.exec(html))) {
    refs.push({ kind: "script", value: match[2] });
  }

  const linkRe = /<link\b[^>]*>/gi;
  while ((match = linkRe.exec(html))) {
    const tag = match[0];
    const href = /\bhref\s*=\s*(['"])(.*?)\1/i.exec(tag);
    if (!href) continue;
    const rel = (/\brel\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2] || "").toLowerCase();
    if (/(stylesheet|modulepreload|preload|icon)/.test(rel)) {
      refs.push({ kind: rel || "link", value: href[2] });
    }
  }
  return refs;
}

function sourceReason(entries, packageJsonText) {
  const names = new Set(entries.map((entry) => entry.lowerName));
  if (entries.some((entry) => entry.lowerName.startsWith("node_modules/"))) {
    return "node_modules";
  }

  const hasConfig = entries.some((entry) =>
    /^(vite|next|nuxt|astro|svelte|webpack|rollup|parcel|rsbuild|rspack|angular|vue|tailwind|postcss)\.config\.(js|cjs|mjs|ts|mts|cts)$/i.test(entry.name)
  );
  const hasSourceDir = entries.some((entry) =>
    /^(src|app|pages|components)\//i.test(entry.name)
  );
  const hasLock = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].some((name) =>
    names.has(name)
  );

  if (!names.has("package.json") && !hasConfig && !hasSourceDir && !hasLock) return "";
  if (hasConfig || hasSourceDir || hasLock) return "source";

  try {
    const pkg = JSON.parse(packageJsonText || "{}");
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {})
    };
    const looksFrontend = Object.keys(deps).some((name) =>
      /^(vite|next|nuxt|astro|svelte|react|react-dom|vue|@vitejs\/|@sveltejs\/|@astrojs\/|@angular\/|webpack|parcel|tailwindcss)$/i.test(name)
    );
    if (looksFrontend || pkg.scripts?.build || pkg.scripts?.dev || pkg.scripts?.start) {
      return "source";
    }
  } catch {
    return "source";
  }
  return "";
}

/**
 * Validate that a ZIP can be deployed as a static site without cloud build.
 */
export async function validateStaticZipFile(file, lang = "zh") {
  const locale = safeLocale(lang);
  const m = sourceMessages[locale];

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return { valid: false, title: m.title, message: m.invalidZip };
  }

  const entries = normalizeEntries(zip);
  const names = new Set(entries.map((entry) => entry.lowerName));
  const packageEntry = entries.find((entry) => entry.lowerName === "package.json");
  const packageJsonText = packageEntry
    ? await zip.file(packageEntry.originalName)?.async("string")
    : "";
  const reason = sourceReason(entries, packageJsonText);
  if (reason === "node_modules") {
    return { valid: false, title: m.title, message: m.nodeModules };
  }

  const rootIndex = entries.find((entry) => entry.lowerName === "index.html");
  if (!rootIndex) {
    return {
      valid: false,
      title: m.title,
      message: reason || names.has("dist/index.html") || names.has("build/index.html") || names.has("out/index.html")
        ? m.source
        : m.missingIndex
    };
  }

  const htmlText = await zip.file(rootIndex.originalName)?.async("string");
  const refs = extractAssetRefs(htmlText || "");
  const sourceRef = refs.find((ref) => {
    const normalized = normalizeHtmlRef(ref.value, rootIndex.name).toLowerCase();
    return normalized.startsWith("src/") || /\.(ts|tsx|jsx|vue|svelte|astro)$/i.test(normalized);
  });
  if (sourceRef || reason) {
    return { valid: false, title: m.title, message: m.source };
  }

  const missingAsset = refs.find((ref) => {
    const normalized = normalizeHtmlRef(ref.value, rootIndex.name).toLowerCase();
    const ext = normalized.split(".").pop();
    if (!["js", "mjs", "css"].includes(ext)) return false;
    return !names.has(normalized);
  });
  if (missingAsset) {
    return { valid: false, title: m.title, message: m.missingAssets };
  }

  return { valid: true };
}
