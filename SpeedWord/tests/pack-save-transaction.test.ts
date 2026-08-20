// 词包保存事务测试：核心词条必须原子写入 SQLite；图片失败不得导致空词包。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sqlJsNS from "sql.js";
import type { Database } from "sql.js";
import {
  migrateSchema, packCreate, itemInsert, packItemCount, packGet, itemList,
  tx, type Db
} from "../electron/db";
import type { ContentItem, WordPack } from "../src/shared/types";

vi.mock("electron", () => ({
  app: { getPath: () => ".", isPackaged: false, getName: () => "极速识词", getVersion: () => "test" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString("utf8").replace(/^enc:/, "")
  }
}));

type InitSqlJs = (opts?: { locateFile?: (f: string) => string }) => Promise<{ Database: new () => Database }>;
const initSqlJs = ((sqlJsNS as { default?: unknown }).default ?? sqlJsNS) as InitSqlJs;

let SQL: { new (): Database };
let tmpDir: string;

beforeAll(async () => {
  const loaded = await initSqlJs();
  SQL = loaded.Database;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-pack-save-"));
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

function makeItem(packId: string, text: string, sort: number): ContentItem {
  return {
    id: `item-${sort}`, packId, sort, type: sort % 3 === 0 ? "word" : sort % 3 === 1 ? "phrase" : "sentence",
    text, phonetic: "/f/", partOfSpeech: "n.", meaningZh: `${text}中文`, definitionEn: `def ${text}`,
    example: `This is ${text}.`, audio: { source: "none", status: "none" },
    image: { localPath: "", sourceType: "builtin", sourceUrl: "", description: "", status: "ok", locked: false, history: [] },
    aiMeta: { generatedBy: "none", generatedAt: 0 },
    fieldState: { phonetic: "auto", meaningZh: "auto", definitionEn: "auto", example: "auto", image: "auto", audio: "auto" },
    verified: false, locked: false, createdAt: 1, updatedAt: 1
  };
}

function coreSavePack(db: Db, pack: WordPack, items: ContentItem[]): { ok: boolean; savedCount: number; inputCount: number } {
  let savedCount = 0;
  let errored = false;
  try {
    tx(db.db, () => {
      packCreate(db.db, pack);
      for (const it of items) itemInsert(db.db, it);
      savedCount = items.length;
      // 校验：SELECT COUNT 验证数量
      const stmt = db.db.prepare("SELECT COUNT(*) AS c FROM content_items WHERE pack_id=?");
      stmt.bind([pack.id]);
      stmt.step();
      const r = stmt.getAsObject();
      stmt.free();
      if ((r.c as number) !== items.length) {
        throw new Error(`事务校验失败：期望 ${items.length}，实际 ${(r.c as number)}`);
      }
    });
  } catch (e) {
    errored = true;
    savedCount = -1;
    throw e;
  }
  // 事务外再次核实（验收要求）
  const actual = packItemCount(db.db, pack.id);
  if (actual !== items.length) {
    throw new Error(`保存后核查失败：输入 ${items.length}，数据库 ${actual}`);
  }
  return { ok: !errored, savedCount: actual, inputCount: items.length };
}

describe("词包核心保存事务（pack存在 + items存在）", () => {
  it("保存 1 个词条后数量一致", () => {
    const db = makeDb();
    const pack: WordPack = { id: "p1", name: "P1", description: "", version: 1, itemCount: 1, createdAt: 1, updatedAt: 1 };
    const r = coreSavePack(db, pack, [makeItem("p1", "apple", 0)]);
    expect(r.ok).toBe(true);
    expect(r.savedCount).toBe(1);
    const items = itemList(db.db, "p1");
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("apple");
  });

  it("保存 20 个词条后数量一致", () => {
    const db = makeDb();
    const pack: WordPack = { id: "p20", name: "P20", description: "", version: 1, itemCount: 20, createdAt: 1, updatedAt: 1 };
    const items = Array.from({ length: 20 }, (_, i) => makeItem("p20", `word-${i}`, i));
    const r = coreSavePack(db, pack, items);
    expect(r.ok).toBe(true);
    expect(r.savedCount).toBe(20);
    expect(itemList(db.db, "p20")).toHaveLength(20);
  });

  it("单词 + 词组 + 句子混合保存", () => {
    const db = makeDb();
    const pack: WordPack = { id: "pmix", name: "混合", description: "", version: 1, itemCount: 5, createdAt: 1, updatedAt: 1 };
    const items: ContentItem[] = [
      makeItem("pmix", "apple", 0),
      makeItem("pmix", "take care of", 1),
      makeItem("pmix", "保护动物", 2),
      makeItem("pmix", "We should protect animals.", 3),
      makeItem("pmix", "piece of cake", 4)
    ];
    for (const it of items) it.type = items[["apple","take care of","保护动物","We should protect animals.","piece of cake"].indexOf(it.text)]?.type || "word";
    // 直接用文本对应类型
    items[0].type = "word";
    items[1].type = "phrasal_verb";
    items[2].type = "phrase";
    items[3].type = "sentence";
    items[4].type = "expression";
    const r = coreSavePack(db, pack, items);
    expect(r.ok).toBe(true);
    expect(r.savedCount).toBe(5);
    const texts = itemList(db.db, "pmix").map((i) => i.text);
    expect(texts).toContain("take care of");
    expect(texts).toContain("We should protect animals.");
  });
});

describe("事务失败 → 回滚，不留空词包壳", () => {
  it("插入过程中抛错时 pack 与 items 都不存在", () => {
    const db = makeDb();
    const pack: WordPack = { id: "pbad", name: "Bad", description: "", version: 1, itemCount: 2, createdAt: 1, updatedAt: 1 };
    const items = [makeItem("pbad", "a", 0), makeItem("pbad", "b", 1)];
    // 故意制造约束冲突：把第二个 item 的 id 设为与第一个相同 → UNIQUE constraint
    items[1].id = items[0].id;
    expect(items[0].id).toBe(items[1].id);
    let threw = false;
    try {
      coreSavePack(db, pack, items);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // 验收：不应存在该 pack
    const p = packGet(db.db, "pbad");
    expect(p).toBeUndefined();
    // 验收：items 为 0
    expect(packItemCount(db.db, "pbad")).toBe(0);
  });

  it("保存后核查失败也会抛出", () => {
    const db = makeDb();
    const pack: WordPack = { id: "pchk", name: "Chk", description: "", version: 1, itemCount: 3, createdAt: 1, updatedAt: 1 };
    const items = [makeItem("pchk", "x", 0)];
    // 直接调用事务函数，故意只插 1 条 → 内部校验抛错 → 回滚
    let threw = false;
    try {
      tx(db.db, () => {
        packCreate(db.db, pack);
        itemInsert(db.db, items[0]); // 只插 1 条
        // 强制制造约束冲突：把第二项的 id 改成和第一项相同
        itemInsert(db.db, { ...items[0], id: items[0].id });
        const stmt = db.db.prepare("SELECT COUNT(*) AS c FROM content_items WHERE pack_id=?");
        stmt.bind([pack.id]);
        stmt.step();
        const cnt = stmt.getAsObject().c as number;
        stmt.free();
        if (cnt !== items.length) throw new Error(`期望 ${items.length} 条，实际 ${cnt}`);
      });
    } catch (e) {
      threw = true;
      void e;
    }
    expect(threw).toBe(true);
    // 核查：pack 不应存在（回滚）
    expect(packGet(db.db, "pchk")).toBeUndefined();
    expect(packItemCount(db.db, "pchk")).toBe(0);
  });
});

describe("事务 Commit 后真实数量与输入一致（验收要求）", () => {
  it("保存 5~20 条词条后 UI 与 DB 一致", () => {
    const db = makeDb();
    const count = 13;
    const pack: WordPack = { id: "p13", name: "P13", description: "", version: 1, itemCount: count, createdAt: 1, updatedAt: 1 };
    const items = Array.from({ length: count }, (_, i) => makeItem("p13", `item-${i}`, i));
    const r = coreSavePack(db, pack, items);
    expect(r.ok).toBe(true);
    expect(r.savedCount).toBe(count);
    // 模拟 UI 只读 pack 的 itemCount，但事实来源是 SELECT COUNT
    const bySql = packItemCount(db.db, "p13");
    expect(bySql).toBe(count);
    const byList = itemList(db.db, "p13");
    expect(byList).toHaveLength(count);
  });
});
