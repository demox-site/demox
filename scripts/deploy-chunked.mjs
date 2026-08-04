import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";

const endpoint = process.env.DEPLOY_URL;
const token = process.env.DEMOX_TOKEN;
const websiteId = process.env.WEBSITE_ID;
const fileName = process.env.WEBSITE_NAME || "dist";
const zipPath = process.env.DEPLOY_ZIP_PATH || "/tmp/deploy.zip";

if (!endpoint || !token || !websiteId) {
  throw new Error("缺少 DEPLOY_URL、DEMOX_TOKEN 或 WEBSITE_ID");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function post(payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Demox API 返回非 JSON 响应 (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const error = new Error(data.message || data.error || `HTTP ${response.status}`);
    error.code = data.code;
    throw error;
  }
  return data;
}

async function retry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

const fileStat = await stat(zipPath);
const fileSha256 = await sha256File(zipPath);
const requestId = randomUUID();
const init = await retry(() => post({
  action: "init_deploy_upload",
  requestId,
  fileName,
  websiteId,
  totalSize: fileStat.size,
  sha256: fileSha256
}));
if (!init.success) throw new Error(init.message || "初始化上传失败");

let completionStarted = false;
const file = await open(zipPath, "r");
try {
  for (let index = 0; index < init.totalChunks; index++) {
    const offset = index * init.chunkSize;
    const length = Math.min(init.chunkSize, fileStat.size - offset);
    const chunk = Buffer.allocUnsafe(length);
    const { bytesRead } = await file.read(chunk, 0, length, offset);
    if (bytesRead !== length) throw new Error(`读取分块 ${index + 1} 不完整`);
    const chunkSha256 = createHash("sha256").update(chunk).digest("hex");
    const result = await retry(() => post({
      action: "upload_deploy_chunk",
      uploadId: init.uploadId,
      chunkIndex: index,
      chunkSha256,
      chunkBase64: chunk.toString("base64")
    }));
    if (!result.success) throw new Error(result.message || `上传分块 ${index + 1} 失败`);
    console.log(`uploaded ${index + 1}/${init.totalChunks}`);
  }

  completionStarted = true;
  for (let attempt = 0; attempt < 80; attempt++) {
    const result = await retry(() => post({
      action: "complete_deploy_upload",
      uploadId: init.uploadId
    }));
    if (result.success) {
      console.log(`deployed: ${result.url}`);
      process.exitCode = 0;
      break;
    }
    if (result.code !== "UPLOAD_COMPLETING") throw new Error(result.message || "部署失败");
    await sleep(result.retryAfterMs || 1500);
    if (attempt === 79) throw new Error("等待部署完成超时");
  }
} catch (error) {
  if (!completionStarted) {
    await post({ action: "abort_deploy_upload", uploadId: init.uploadId }).catch(() => {});
  }
  throw error;
} finally {
  await file.close();
}
