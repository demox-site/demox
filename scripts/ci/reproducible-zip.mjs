import { createReadStream, createWriteStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** 统一包只允许 lockfile 安装。不要改回 npm install。 */
export const LOCKFILE_INSTALL_ARGS = Object.freeze(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);

/**
 * 压缩包里的权限只保留两种，避免 umask 把同一份源码打成不同 sha256。
 * 可执行位来自文件本身（npm 包里的 bin），归一成 0755 或 0644。
 */
export function zipMode(name, mode = 0) {
  const base = String(name).split("/").pop();
  if (base === "scf_bootstrap") return 0o755;
  return (mode & 0o111) ? 0o755 : 0o644;
}

function byCodePoint(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export async function listZipFiles(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => byCodePoint(a.name, b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listZipFiles(directory, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort((a, b) => byCodePoint(a.split(path.sep).join("/"), b.split(path.sep).join("/")));
}

/** ZIP 的 DOS 时间用本地年月日。用本地 1980-01-01 00:00:00，换时区也不会改字节。 */
function zipDate() {
  return new Date(1980, 0, 1, 0, 0, 0);
}

/** 稳定文件顺序、固定 mtime、归一化权限。同一目录树打两次，sha256 相同。
 * archiver.file 会并行 stat，完成顺序不稳定，同样的内容会打出不同 sha256。
 * 这里按码点顺序读入字节再 append，不把 stat 完成顺序写进包。符号链接不进包。 */
export async function writeDeterministicZip(stageDir, zipPath) {
  const archiver = (await import("archiver")).default;
  const archive = archiver("zip", { zlib: { level: 9 }, statConcurrency: 1 });
  const output = createWriteStream(zipPath);
  const completion = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  const skip = path.resolve(zipPath);
  const files = await listZipFiles(stageDir);
  const storedDate = zipDate();
  for (const relative of files) {
    const name = relative.split(path.sep).join("/");
    const absolute = path.join(stageDir, relative);
    if (path.resolve(absolute) === skip) continue;
    const fileStat = await stat(absolute);
    const body = await readFile(absolute);
    archive.append(body, { name, date: storedDate, mode: zipMode(name, fileStat.mode) });
  }
  await archive.finalize();
  await completion;
}

export function openZipReadStream(filePath) {
  return createReadStream(filePath);
}
