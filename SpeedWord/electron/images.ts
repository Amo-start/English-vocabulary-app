// 图片引擎：内置素材 / 图片API搜索 / AI生成 / 教师上传
import fs from "node:fs";
import path from "node:path";
import { assetsDir, mediaDir, downloadTo, saveDataUrl, safeJsonParse, httpGet, copyToMedia, randomFilename } from "./util";
import type { ItemImage, ImageSourceType } from "../src/shared/types";
import { AiError, type ImageProvider } from "./ai";

export interface BuiltinImageIndex {
  [word: string]: string;
}

let builtinIndexCache: BuiltinImageIndex | null = null;

function builtinIndex(): BuiltinImageIndex {
  if (builtinIndexCache) return builtinIndexCache;
  try {
    const raw = fs.readFileSync(path.join(assetsDir("builtin-images", "builtin-index.json")), "utf8");
    builtinIndexCache = safeJsonParse<BuiltinImageIndex>(raw, {});
  } catch {
    builtinIndexCache = {};
  }
  return builtinIndexCache;
}

/** 首次启动把内置图片复制到用户数据目录，统一走 sw:// 协议 */
export function ensureBuiltinImages(): void {
  const idx = builtinIndex();
  const srcDir = path.join(assetsDir("builtin-images"));
  const dstDir = mediaDir("builtin");
  let changed = false;
  for (const file of Object.values(idx)) {
    const dst = path.join(dstDir, file);
    if (!fs.existsSync(dst)) {
      const src = path.join(srcDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        changed = true;
      }
    }
  }
  // 内置索引元数据写入 media_assets 由调用方处理（此处仅复制文件）
  void changed;
}

/** 查询内置素材（具体名词优先） */
export function findBuiltinImage(text: string): { filename: string; word: string } | null {
  const idx = builtinIndex();
  const key = (text || "").toLowerCase().trim();
  if (idx[key]) return { filename: idx[key], word: key };
  // 词形还原再查
  const singular = key.replace(/ies$/, "y").replace(/(es|s)$/, "");
  if (idx[singular]) return { filename: idx[singular], word: singular };
  return null;
}

export interface ImageResult {
  /** sw:// 协议 URL（渲染端可直接 <img src>） */
  localPath: string;
  filename: string;
  sourceType: ImageSourceType;
  sourceUrl?: string;
  description?: string;
}

/** 图片 API 搜索（Wikimedia Commons，免费无 Key） */
export async function searchImageApi(query: string, limit = 6): Promise<Array<{ thumbUrl: string; pageUrl: string; title: string }>> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}` +
    `&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|size&iiurlwidth=800&format=json`;
  try {
    const buf = await httpGet(url, 15000);
    const data = JSON.parse(buf.toString("utf8")) as {
      query?: { pages?: Record<string, { title: string; imageinfo?: Array<{ thumburl?: string; url?: string }> }> };
    };
    const pages = data.query?.pages || {};
    return Object.values(pages)
      .map((p) => {
        const ii = p.imageinfo?.[0];
        return ii?.thumburl
          ? { thumbUrl: ii.thumburl, pageUrl: ii.url || "", title: p.title }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .filter((x) => !/\.(svg|tif|tiff|ogg|ogv|pdf)$/i.test(x.thumbUrl))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** AI 生成图片并缓存到本地，返回 sw:// 路径 */
export async function generateImage(provider: ImageProvider, description: string, fileNameHint?: string): Promise<ImageResult> {
  const dir = mediaDir("ai");
  let result: { b64?: string; url?: string };
  try {
    result = await provider.generate(description);
  } catch (e) {
    throw new AiError("image_generate_failed", `AI 图片生成失败：${(e as Error).message}`);
  }
  let filename: string;
  if (result.b64) {
    filename = saveDataUrl(`data:image/png;base64,${result.b64}`, dir, "png");
  } else if (result.url) {
    filename = await downloadTo(result.url, dir, "png");
  } else {
    throw new AiError("image_generate_failed", "AI 图片生成失败：未返回图片数据");
  }
  void fileNameHint;
  return {
    localPath: `sw://img/${filename}`,
    filename,
    sourceType: "ai",
    sourceUrl: result.url,
    description
  };
}

/** 下载图片 API 结果到本地缓存 */
export async function cacheApiImage(thumbUrl: string, pageUrl: string, description: string): Promise<ImageResult> {
  const dir = mediaDir("api");
  const ext = (() => {
    const m = /\.(jpe?g|png|webp|gif)$/i.exec(thumbUrl);
    return m ? m[1].toLowerCase() : "jpg";
  })();
  const filename = await downloadTo(thumbUrl, dir, ext);
  return {
    localPath: `sw://img/${filename}`,
    filename,
    sourceType: "api",
    sourceUrl: pageUrl || thumbUrl,
    description
  };
}

/** 教师上传本地图片 → 复制到 userData/media/user */
export async function importUserImage(srcPath: string): Promise<ImageResult> {
  if (!fs.existsSync(srcPath)) throw new Error("图片文件不存在");
  const dir = mediaDir("user");
  const ext = path.extname(srcPath).replace(/^\./, "") || "png";
  const filename = copyToMedia(srcPath, dir, ext);
  return {
    localPath: `sw://img/${filename}`,
    filename,
    sourceType: "user",
    description: "",
    sourceUrl: srcPath
  };
}

/** 根据词条选择图片策略 */
export interface ImageStrategyOpts {
  hasAiImage: boolean;
  allowApi: boolean;
}

export function planImageStrategy(text: string, type: string, opts: ImageStrategyOpts): "builtin" | "ai" | "api" | "none" {
  // 具体名词 → 内置/API；动作/短语/抽象词 → AI 情境图
  const concreteHint = type === "word";
  if (concreteHint && findBuiltinImage(text)) return "builtin";
  if (concreteHint && opts.allowApi) return "api";
  if (!concreteHint && opts.hasAiImage) return "ai";
  if (opts.allowApi) return "api";
  if (opts.hasAiImage) return "ai";
  return "none";
}

export function builtinUrl(filename: string): string {
  return `sw://img/${filename}`;
}

/** 供渲染端读取图片二进制（经 sw:// 协议） */
export function resolveImagePath(mediaRelPath: string): string | null {
  // mediaRelPath 形如 "ai/xxx.png" 或 "xxx.png" 或 "sw://img/xxx"
  const clean = mediaRelPath.replace(/^sw:\/\/img\//, "");
  const candidates = [
    path.join(mediaDir(), clean),
    path.join(mediaDir("builtin"), clean),
    path.join(mediaDir("ai"), clean),
    path.join(mediaDir("api"), clean),
    path.join(mediaDir("user"), clean)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function newImagePlaceholder(): ItemImage {
  return {
    localPath: "",
    sourceType: "builtin",
    status: "ok",
    locked: false,
    history: []
  };
}

export { randomFilename };
