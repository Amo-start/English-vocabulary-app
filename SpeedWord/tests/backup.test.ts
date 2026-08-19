// .swpack 导入导出往返 + 全量 dump/restore 回滚
// 使用真实 sql.js 内存库；素材写入临时目录（SPEEDWORD_USER_DATA 覆盖 userData）。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import * as sqlJsNS from "sql.js";
import type { Database } from "sql.js";
import {
  migrateSchema, packCreate, itemUpsert, itemList, packList, packGet, dumpAll, restoreDump,
  sessionCreate, sessionGet, feedbackUpsert, feedbackListBySession, reviewInsert, reviewList,
  type Db
} from "../electron/db";

// sql.js 是 CJS 模块，esbuild 互操作下 default 可能是命名空间本身。
// 兼容两种形态取出 initSqlJs 工厂函数。
type InitSqlJs = (opts?: { locateFile?: (f: string) => string }) => Promise<{ Database: new () => Database }>;
const initSqlJs = ((sqlJsNS as { default?: unknown }).default ?? sqlJsNS) as InitSqlJs;
import { importSwpackFile } from "../electron/backup";
import type { ContentItem, WordPack } from "../src/shared/types";

vi.mock("electron", () => ({
  dialog: {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] })
  },
  app: { getVersion: () => "test", getPath: () => ".", isPackaged: false }
}));

let SQL: { new (): Database };
let tmpDir: string;

beforeAll(async () => {
  const loaded = await initSqlJs();
  SQL = loaded.Database;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swtest-"));
  process.env.SPEEDWORD_USER_DATA = tmpDir;
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

function makeDb(): Db {
  const db = new SQL();
  migrateSchema(db);
  return { db, file: ":memory:", save: () => {}, close: () => {} };
}

function makeItem(packId: string, text: string, sort: number, imagePath = ""): ContentItem {
  return {
    id: `it-${text}-${sort}`, packId, sort, type: "word", text,
    phonetic: "/f/", partOfSpeech: "n.", meaningZh: `${text}中文`, definitionEn: `def ${text}`,
    example: `This is ${text}.`, audio: { source: "none", status: "none" },
    image: { localPath: imagePath, sourceType: imagePath ? "user" : "builtin", sourceUrl: "", description: "", status: "ok", locked: false, history: [] },
    aiMeta: { generatedBy: "none", generatedAt: 0 },
    fieldState: { phonetic: "auto", meaningZh: "edited", definitionEn: "auto", example: "auto", image: "auto", audio: "auto" },
    verified: true, locked: false, createdAt: 0, updatedAt: 0
  };
}

describe(".swpack 导入", () => {
  it("导入词包：词条、词包名、素材重映射全部恢复", async () => {
    // 手工构造一个 .swpack（含图片素材）
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
      format: "speedword-pack", version: 1, appVersion: "test", exportedAt: 1,
      packId: "src-pack", packName: "Unit Test 词包", description: "描述", itemCount: 2
    }));
    zip.file("words.json", JSON.stringify([
      makeItem("src-pack", "apple", 0, "sw://img/pic.png"),
      makeItem("src-pack", "banana", 1)
    ]));
    zip.file("images/pic.png", Buffer.from("fake-png-content"));
    zip.file("metadata/classroom.json", JSON.stringify({ reviewPool: [], sessions: [] }));
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const swp = path.join(tmpDir, "sample.swpack");
    fs.writeFileSync(swp, buf);

    const db = makeDb();
    const r = await importSwpackFile(db, swp);
    expect(r.ok).toBe(true);
    expect(r.packName).toBe("Unit Test 词包");

    const packs = packList(db.db);
    expect(packs).toHaveLength(1);
    const imported = packGet(db.db, packs[0].id)!;
    expect(imported.name).toBe("Unit Test 词包");
    expect(imported.itemCount).toBe(2);

    const items = itemList(db.db, packs[0].id);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.text).sort()).toEqual(["apple", "banana"]);
    // 图片被重映射到本地 media 目录（sw://img/<新文件名>）
    const withImg = items.find((i) => i.text === "apple")!;
    expect(withImg.image.localPath).toMatch(/^sw:\/\/img\/.+(\.png)$/);
    const localFile = path.join(tmpDir, "media", "user", path.basename(withImg.image.localPath.replace(/^sw:\/\/img\//, "")));
    expect(fs.existsSync(localFile)).toBe(true);
    expect(fs.readFileSync(localFile).toString()).toBe("fake-png-content");
    // 教师编辑状态保留
    expect(withImg.fieldState.meaningZh).toBe("edited");
    expect(withImg.verified).toBe(true);
  });

  it("导入损坏文件返回 ok=false，且数据库不变", async () => {
    const bad = path.join(tmpDir, "bad.swpack");
    fs.writeFileSync(bad, "not-a-zip");
    const db = makeDb();
    const r = await importSwpackFile(db, bad);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/导入失败/);
    expect(packList(db.db)).toHaveLength(0);
  });

  it("版本过高拒绝导入", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "speedword-pack", version: 99, packName: "x" }));
    zip.file("words.json", "[]");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const f = path.join(tmpDir, "v99.swpack");
    fs.writeFileSync(f, buf);
    const db = makeDb();
    const r = await importSwpackFile(db, f);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/版本过高/);
  });
});

describe("全量 dump/restore", () => {
  it("dumpAll → restoreDump 往返保留数据（词包/词条/课堂/反馈/复习）", () => {
    const src = makeDb();
    const pack: WordPack = { id: "p1", name: "P1", description: "", version: 1, itemCount: 1, createdAt: 1, updatedAt: 1 };
    packCreate(src.db, pack);
    itemUpsert(src.db, makeItem("p1", "hello", 0));
    sessionCreate(src.db, {
      id: "s1", packId: "p1", gameMode: "quick-read", className: "三一班",
      startedAt: 100, endedAt: 200, itemCount: 1, correctCount: 1, comboMax: 3, summary: { ok: true }
    });
    feedbackUpsert(src.db, {
      id: "f1", sessionId: "s1", packId: "p1", itemId: "it-hello-0",
      signal: "mastered", responseCount: 40, correctCount: 38, notes: "", createdAt: 150
    });
    reviewInsert(src.db, {
      id: "r1", packId: "p1", itemId: "it-hello-0", reason: "重点复习",
      sourceSession: "s1", lastMode: "quick-read", createdAt: 160, lastPracticed: 170
    });
    const dump = dumpAll(src.db);
    expect(dump.packs).toHaveLength(1);
    expect(dump.items).toHaveLength(1);
    expect(dump.sessions).toHaveLength(1);
    expect(dump.sessions[0].className).toBe("三一班");
    expect(dump.feedback).toHaveLength(1);
    expect(dump.review).toHaveLength(1);

    const dst = makeDb();
    restoreDump(dst.db, dump);
    expect(packList(dst.db)).toHaveLength(1);
    expect(itemList(dst.db, "p1")).toHaveLength(1);
    expect(itemList(dst.db, "p1")[0].text).toBe("hello");
    const sess = sessionGet(dst.db, "s1");
    expect(sess).toBeDefined();
    expect(sess!.packId).toBe("p1");
    expect(sess!.summary).toEqual({ ok: true });
    expect(feedbackListBySession(dst.db, "s1")[0].signal).toBe("mastered");
    const rev = reviewList(dst.db, "p1");
    expect(rev).toHaveLength(1);
    expect(rev[0].sourceSession).toBe("s1");
    expect(rev[0].lastPracticed).toBe(170);
  });

  it("restoreDump 覆盖旧数据（先清空）", () => {
    const src = makeDb();
    packCreate(src.db, { id: "pX", name: "New", description: "", version: 1, itemCount: 0, createdAt: 1, updatedAt: 1 });
    const dump = dumpAll(src.db);

    const dst = makeDb();
    packCreate(dst.db, { id: "pOld", name: "Old", description: "", version: 1, itemCount: 0, createdAt: 1, updatedAt: 1 });
    restoreDump(dst.db, dump);
    const ids = packList(dst.db).map((p) => p.id);
    expect(ids).toContain("pX");
    expect(ids).not.toContain("pOld");
  });
});
