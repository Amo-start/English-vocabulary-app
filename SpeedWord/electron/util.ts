// 主进程通用工具：路径、文件、下载、JSON 安全解析
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import http from "node:http";

export function appRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar");
  }
  return path.resolve(__dirname, "..", ".."); // electron-dist/electron -> 项目根
}

export function assetsDir(...sub: string[]): string {
  return path.join(appRoot(), "assets", ...sub);
}

export function dictionaryDir(...sub: string[]): string {
  // 打包后词典放在 extraResources/dictionary
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "dictionary", ...sub);
  }
  return assetsDir("dictionary", ...sub);
}

export function userDataDir(...sub: string[]): string {
  // 测试/便携模式可用环境变量覆盖
  const base = process.env.SPEEDWORD_USER_DATA || app.getPath("userData");
  return path.join(base, ...sub);
}

export function mediaDir(...sub: string[]): string {
  const dir = userDataDir("media", ...sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return "null";
  }
}

export function randomFilename(ext: string, prefix = "m"): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
}

export function extOf(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(clean);
  return m ? m[1].toLowerCase() : "jpg";
}

/** 网络请求：GET（用于下载与词典 API） */
export function httpGet(url: string, timeoutMs = 15000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": "SpeedWord-V4/4.0" } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        httpGet(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`HTTP ${code} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout for ${url}`));
    });
    req.on("error", reject);
  });
}

export function contentTypeToExt(ct: string | undefined, fallback = "jpg"): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/bmp": "bmp"
  };
  return ct ? map[ct] || fallback : fallback;
}

/** 下载文件到目标目录，返回本地文件名 */
export async function downloadTo(url: string, dir: string, ext?: string): Promise<string> {
  const buf = await httpGet(url, 25000);
  const file = randomFilename(ext || extOf(url));
  fs.writeFileSync(path.join(dir, file), buf);
  return file;
}

/** dataURL → 文件，返回文件名 */
export function saveDataUrl(dataUrl: string, dir: string, ext = "png"): string {
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
  const file = randomFilename(ext);
  fs.writeFileSync(path.join(dir, file), Buffer.from(b64, "base64"));
  return file;
}

/** 复制本地文件到 media 目录，返回文件名 */
export function copyToMedia(src: string, dir: string, ext?: string): string {
  const extName = ext || path.extname(src).replace(/^\./, "") || "png";
  const file = randomFilename(extName, "user");
  fs.copyFileSync(src, path.join(dir, file));
  return file;
}

export function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
