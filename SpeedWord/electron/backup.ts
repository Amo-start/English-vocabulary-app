// .swpack 教学词包：可迁移、可备份、可包含素材的本地包
// ├── manifest.json
// ├── words.json
// ├── images/
// ├── audio/
// └── metadata/
// 导出：词条 + 教师修改状态 + 图片 + 音频 + 生成元数据
// 导入：版本校验 → 事务写入 → 失败可回滚
import fs from "node:fs";
import path from "node:path";
import { dialog, app } from "electron";
import JSZip from "jszip";
import type { Db } from "./db";
import { itemList, itemGet, packGet, packCreate, itemUpsert, reviewList, sessionList, feedbackListByPack, tx } from "./db";
import { mediaDir, randomFilename, safeJsonParse } from "./util";
import type { ContentItem, WordPack } from "../src/shared/types";
import { uid } from "../src/shared/uuid";

const SWPACK_FORMAT = "speedword-pack";
const SWPACK_VERSION = 1;

interface Manifest {
  format: string;
  version: number;
  appVersion: string;
  exportedAt: number;
  packId: string;
  packName: string;
  description: string;
  itemCount: number;
}

/** 收集词条引用的本地素材文件（images/audio） */
function collectMedia(item: ContentItem): Array<{ rel: string; abs: string }> {
  const list: Array<{ rel: string; abs: string }> = [];
  const img = item.image?.localPath || "";
  if (img) {
    const rel = img.replace(/^sw:\/\/img\//, "");
    // 仅收集位于 userData/media 下的真实文件
    for (const sub of ["", "builtin", "ai", "api", "user"]) {
      const abs = path.join(mediaDir(sub), rel);
      if (fs.existsSync(abs)) {
        list.push({ rel: `images/${rel}`, abs });
        break;
      }
    }
  }
  const audio = item.audio?.localPath;
  if (audio && fs.existsSync(audio)) {
    list.push({ rel: `audio/${path.basename(audio)}`, abs: audio });
  }
  return list;
}

/** 导出单个词包为 .swpack 文件 */
export async function exportPack(db: Db, packId: string): Promise<{ ok: boolean; file?: string; message?: string; path?: string }> {
  const pack = packGet(db.db, packId);
  if (!pack) return { ok: false, message: "词包不存在" };
  const items = itemList(db.db, packId);
  const zip = new JSZip();

  const manifest: Manifest = {
    format: SWPACK_FORMAT,
    version: SWPACK_VERSION,
    appVersion: app.getVersion(),
    exportedAt: Date.now(),
    packId,
    packName: pack.name,
    description: pack.description,
    itemCount: items.length
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("words.json", JSON.stringify(items, null, 2));

  // 素材
  const added = new Set<string>();
  for (const it of items) {
    for (const m of collectMedia(it)) {
      if (added.has(m.rel)) continue;
      added.add(m.rel);
      zip.file(m.rel, fs.readFileSync(m.abs));
    }
  }
  // metadata：复习池 + 该词包最近的课堂反馈概览
  const review = reviewList(db.db, packId);
  const meta = {
    reviewPool: review,
    sessions: sessionList(db.db).filter((s) => s.packId === packId).slice(0, 20),
    aiMeta: items.map((i) => ({ id: i.id, text: i.text, aiMeta: i.aiMeta, fieldState: i.fieldState }))
  };
  zip.file("metadata/classroom.json", JSON.stringify(meta, null, 2));

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const defaultName = `${sanitize(pack.name)}.swpack`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "导出词包",
    defaultPath: path.join(app.getPath("documents"), defaultName),
    filters: [{ name: "极速识词词包", extensions: ["swpack"] }]
  });
  if (canceled || !filePath) return { ok: false, message: "已取消导出" };
  fs.writeFileSync(filePath, buffer);
  return { ok: true, file: filePath, path: filePath };
}

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

interface LoadedPack {
  manifest: Manifest;
  items: ContentItem[];
  files: Map<string, Buffer>;
  meta: { reviewPool?: unknown[]; sessions?: unknown[] };
}

async function loadSwpack(filePath: string): Promise<LoadedPack> {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const readText = async (name: string): Promise<string | null> => {
    const f = zip.file(name);
    return f ? (await f.async("string")) : null;
  };
  const manifestRaw = await readText("manifest.json");
  if (!manifestRaw) throw new Error("无效的词包文件：缺少 manifest.json");
  const manifest = safeJsonParse<Manifest>(manifestRaw, null as unknown as Manifest);
  if (!manifest || manifest.format !== SWPACK_FORMAT) {
    throw new Error("不是有效的 .swpack 词包文件");
  }
  if (manifest.version > SWPACK_VERSION) {
    throw new Error(`词包版本过高（${manifest.version}），当前软件仅支持 ${SWPACK_VERSION} 及以下`);
  }
  const wordsRaw = await readText("words.json");
  if (!wordsRaw) throw new Error("词包缺少 words.json");
  const items = safeJsonParse<ContentItem[]>(wordsRaw, []);
  if (!Array.isArray(items)) throw new Error("words.json 格式错误");

  // 收集文件（images/**, audio/**）
  const files = new Map<string, Buffer>();
  const entries = Object.values(zip.files);
  for (const e of entries) {
    if (e.dir) continue;
    if (/^(images|audio)\//.test(e.name)) {
      files.set(e.name, await e.async("nodebuffer"));
    }
  }
  const meta = safeJsonParse<{ reviewPool?: unknown[]; sessions?: unknown[] }>(
    await readText("metadata/classroom.json") || "{}", {}
  );
  return { manifest, items, files, meta };
}

/** 导入词包（文件校验 → DB 事务 → 素材落盘），失败回滚数据库写入 */
export async function importPack(db: Db): Promise<{ ok: boolean; packId?: string; packName?: string; message?: string }> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "导入词包",
    filters: [{ name: "极速识词词包", extensions: ["swpack"] }],
    properties: ["openFile"]
  });
  if (canceled || !filePaths?.[0]) return { ok: false, message: "已取消导入" };
  return importSwpackFile(db, filePaths[0]);
}

export async function importSwpackFile(db: Db, filePath: string): Promise<{ ok: boolean; packId?: string; packName?: string; message?: string }> {
  let loaded: LoadedPack;
  try {
    loaded = await loadSwpack(filePath);
  } catch (e) {
    return { ok: false, message: `导入失败：${(e as Error).message}` };
  }

  // 新词包 ID（避免与已有数据冲突）
  const newPackId = uid("pack");
  const now = Date.now();
  const newPack: WordPack = {
    id: newPackId,
    name: loaded.manifest.packName || "导入词包",
    description: loaded.manifest.description || "",
    version: 1,
    itemCount: loaded.items.length,
    createdAt: now,
    updatedAt: now
  };

  // 素材先落到用户数据目录（幂等；失败不破坏 DB）
  const mediaMap = new Map<string, string>();
  try {
    for (const [rel, buf] of loaded.files) {
      const isImage = rel.startsWith("images/");
      const dir = mediaDir(isImage ? (isAiPath(rel) ? "ai" : "user") : "audio");
      const file = randomFilename(path.extname(rel).replace(/^\./, "") || (isImage ? "png" : "mp3"), isImage ? "imp" : "aud");
      fs.writeFileSync(path.join(dir, file), buf);
      mediaMap.set(rel, isImage ? `sw://img/${file}` : path.join(dir, file));
    }
  } catch (e) {
    return { ok: false, message: `素材写入失败：${(e as Error).message}（数据库未改动）` };
  }

  // DB 事务写入，失败回滚
  try {
    tx(db.db, () => {
      packCreate(db.db, newPack);
      let sort = 0;
      for (const it of loaded.items) {
        const copy: ContentItem = { ...it, id: uid("item"), packId: newPackId, sort: sort++, createdAt: now, updatedAt: now };
        // 图片：zip 内路径为 images/<rel>，本地路径为 sw://img/<rel>，导入时按新文件名重映射
        if (it.image?.localPath?.startsWith("sw://img/")) {
          const rel = it.image.localPath.replace(/^sw:\/\/img\//, "");
          const key = `images/${rel}`;
          if (mediaMap.has(key)) {
            copy.image = { ...it.image, localPath: mediaMap.get(key)! };
          } else {
            copy.image = { ...it.image, localPath: it.image.localPath };
          }
        }
        if (it.audio?.localPath) {
          const key = `audio/${path.basename(it.audio.localPath)}`;
          if (mediaMap.has(key)) {
            copy.audio = { ...it.audio, localPath: mediaMap.get(key)! };
          }
        }
        itemUpsert(db.db, copy);
      }
    });
    db.save();
    return { ok: true, packId: newPackId, packName: newPack.name };
  } catch (e) {
    return { ok: false, message: `导入失败，已回滚：${(e as Error).message}` };
  }
}

function isAiPath(rel: string): boolean {
  // 简单判断：builtin 图片从内置索引恢复；其余按 user 处理
  return false;
}

/** 导出整库备份（设置 + 全部词包），返回保存路径 */
export async function exportFullBackup(db: Db): Promise<{ ok: boolean; message?: string; path?: string }> {
  const zip = new JSZip();
  const dump = (await import("./db")).dumpAll(db.db);
  zip.file("manifest.json", JSON.stringify({
    format: "speedword-full-backup", version: 1, appVersion: app.getVersion(), exportedAt: Date.now()
  }, null, 2));
  zip.file("data.json", JSON.stringify(dump, null, 2));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "导出整库备份",
    defaultPath: path.join(app.getPath("documents"), `speedword-backup-${Date.now()}.json`),
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (canceled || !filePath) return { ok: false, message: "已取消" };
  fs.writeFileSync(filePath, buffer);
  return { ok: true, path: filePath };
}

export function hasItemRef(db: Db, itemId: string): boolean {
  return !!itemGet(db.db, itemId);
}
