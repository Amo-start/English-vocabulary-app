// SQLite 数据层（sql.js / WASM，无需本地编译，Windows 低硬件可运行）
// V4.1: 新增 itemsAddDrafts — Draft→Persistent 映射，主进程生成正式 UUID
import type { Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { userDataDir, safeJsonParse, safeStringify } from "./util";
import type {
  ContentItem, WordPack, MediaAsset, ClassroomSession, ClassroomFeedback,
  ReviewEntry, AiProviderConfig
} from "../src/shared/types";
import type { DraftSavePayload } from "../src/shared/draft-types";

export interface Db {
  db: SqlJsDatabase;
  file: string;
  save(): void;
  close(): void;
}

// ---------- 初始化 ----------
export async function openDatabase(): Promise<Db> {
  const initSqlJs = (await import("sql.js")).default;
  // db.js 位于 electron-dist/electron/，wasm 复制在 electron-dist/ 根（打包后同样结构）
  const wasmPath = path.resolve(__dirname, "..", "sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const dir = userDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "speedword.db");
  let db: SqlJsDatabase;
  if (fs.existsSync(file)) {
    db = new SQL.Database(fs.readFileSync(file));
  } else {
    db = new SQL.Database();
  }
  migrateSchema(db);
  persist(db, file);
  return {
    db,
    file,
    save() { persist(db, file); },
    close() { try { db.close(); } catch { /* noop */ } }
  };
}

function persist(db: SqlJsDatabase, file: string): void {
  const data = db.export();
  fs.writeFileSync(file, Buffer.from(data));
}

export function migrateSchema(db: SqlJsDatabase): void {
  db.exec(`
  PRAGMA journal_mode=OFF;
  CREATE TABLE IF NOT EXISTS word_packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    version INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS content_items (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    sort INTEGER DEFAULT 0,
    type TEXT DEFAULT 'word',
    text TEXT NOT NULL,
    phonetic TEXT DEFAULT '',
    part_of_speech TEXT DEFAULT '',
    meaning_zh TEXT DEFAULT '',
    definition_en TEXT DEFAULT '',
    example TEXT DEFAULT '',
    audio_json TEXT DEFAULT '{}',
    image_json TEXT DEFAULT '{}',
    ai_meta_json TEXT DEFAULT '{}',
    field_state_json TEXT DEFAULT '{}',
    verified INTEGER DEFAULT 0,
    locked INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_items_pack ON content_items(pack_id);
  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    local_path TEXT DEFAULT '',
    source_type TEXT DEFAULT 'builtin',
    source_url TEXT DEFAULT '',
    description TEXT DEFAULT '',
    mime TEXT DEFAULT '',
    meta_json TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS classroom_sessions (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    game_mode TEXT DEFAULT '',
    class_name TEXT DEFAULT '',
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    item_count INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    combo_max INTEGER DEFAULT 0,
    summary_json TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS classroom_feedback (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    pack_id TEXT DEFAULT '',
    item_id TEXT NOT NULL,
    signal TEXT DEFAULT 'unrated',
    response_count INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_session ON classroom_feedback(session_id);
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS ai_provider_settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS review_pool (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    reason TEXT DEFAULT '',
    source_session TEXT DEFAULT '',
    last_mode TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    last_practiced INTEGER
  );
  `);

  // V4.1: 将存量 builtin 图片标记为 legacy_builtin（离线兜底）
  const schemaVer = settingsGet(db, "schema_version");
  if (!schemaVer || Number(schemaVer) < 2) {
    db.run(`
      UPDATE content_items
      SET image_json = json_set(image_json, '$.sourceType', 'legacy_builtin')
      WHERE json_extract(image_json, '$.sourceType') = 'builtin'
    `);
    settingsSet(db, "schema_version", "2");
  }
}

// ---------- 工具 ----------
function all<T = Record<string, unknown>>(db: SqlJsDatabase, sql: string, params: (string | number | null)[] = []): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

function one<T = Record<string, unknown>>(db: SqlJsDatabase, sql: string, params: (string | number | null)[] = []): T | undefined {
  return all<T>(db, sql, params)[0];
}

function run(db: SqlJsDatabase, sql: string, params: (string | number | null)[] = []): void {
  const stmt = db.prepare(sql);
  try {
    stmt.run(params);
  } finally {
    stmt.free();
  }
}

export function tx<T>(db: SqlJsDatabase, fn: () => T): T {
  db.run("BEGIN");
  try {
    const r = fn();
    db.run("COMMIT");
    return r;
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

// ---------- 行映射 ----------
export interface ItemRow {
  id: string; pack_id: string; sort: number; type: string; text: string;
  phonetic: string; part_of_speech: string; meaning_zh: string; definition_en: string;
  example: string; audio_json: string; image_json: string; ai_meta_json: string;
  field_state_json: string; verified: number; locked: number;
  created_at: number; updated_at: number;
}

export function rowToItem(r: ItemRow): ContentItem {
  return {
    id: r.id,
    packId: r.pack_id,
    sort: r.sort,
    type: r.type as ContentItem["type"],
    text: r.text,
    phonetic: r.phonetic,
    partOfSpeech: r.part_of_speech,
    meaningZh: r.meaning_zh,
    definitionEn: r.definition_en,
    example: r.example,
    audio: safeJsonParse(r.audio_json, { source: "none", status: "none" }),
    image: safeJsonParse(r.image_json, { localPath: "", sourceType: "builtin", status: "ok", locked: false, history: [] }),
    aiMeta: safeJsonParse(r.ai_meta_json, { generatedBy: "none", generatedAt: r.created_at }),
    fieldState: safeJsonParse(r.field_state_json, {
      phonetic: "auto", meaningZh: "auto", definitionEn: "auto", example: "auto", image: "auto", audio: "auto"
    }),
    verified: !!r.verified,
    locked: !!r.locked,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function itemToRow(i: ContentItem): (string | number | null)[] {
  return [
    i.id, i.packId, i.sort, i.type, i.text, i.phonetic, i.partOfSpeech, i.meaningZh,
    i.definitionEn, i.example,
    safeStringify(i.audio), safeStringify(i.image), safeStringify(i.aiMeta),
    safeStringify(i.fieldState), i.verified ? 1 : 0, i.locked ? 1 : 0,
    i.createdAt, i.updatedAt
  ];
}

export const INSERT_ITEM_SQL = `
  INSERT INTO content_items (id, pack_id, sort, type, text, phonetic, part_of_speech,
    meaning_zh, definition_en, example, audio_json, image_json, ai_meta_json,
    field_state_json, verified, locked, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`;

export const UPDATE_ITEM_SQL = `
  UPDATE content_items SET sort=?, type=?, text=?, phonetic=?, part_of_speech=?,
    meaning_zh=?, definition_en=?, example=?, audio_json=?, image_json=?, ai_meta_json=?,
    field_state_json=?, verified=?, locked=?, updated_at=?
  WHERE id=?
`;

// ---------- 词包 ----------
interface PackRow {
  id: string; name: string; description: string; version: number;
  created_at: number; updated_at: number; c: number;
}

function rowToPack(r: PackRow): WordPack {
  return {
    id: r.id, name: r.name, description: r.description, version: r.version,
    itemCount: r.c, createdAt: r.created_at, updatedAt: r.updated_at
  };
}

export function packList(db: SqlJsDatabase): WordPack[] {
  const rows = all<PackRow>(
    db,
    `SELECT p.*, (SELECT COUNT(*) FROM content_items i WHERE i.pack_id=p.id) AS c
     FROM word_packs p ORDER BY p.updated_at DESC`
  );
  return rows.map(rowToPack);
}

export function packGet(db: SqlJsDatabase, id: string): WordPack | undefined {
  return packList(db).find((p) => p.id === id);
}

export function packCreate(db: SqlJsDatabase, pack: WordPack): void {
  run(db, `INSERT INTO word_packs (id,name,description,version,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
    [pack.id, pack.name, pack.description, pack.version, pack.createdAt, pack.updatedAt]);
}

export function packUpdate(db: SqlJsDatabase, id: string, name: string, description: string): void {
  run(db, `UPDATE word_packs SET name=?, description=?, updated_at=? WHERE id=?`,
    [name, description, Date.now(), id]);
}

export function packDelete(db: SqlJsDatabase, id: string): void {
  tx(db, () => {
    // 级联删除子数据
    const itemIds = all<{ id: string }>(db, `SELECT id FROM content_items WHERE pack_id=?`, [id]).map((r) => r.id);
    for (const itId of itemIds) {
      run(db, `DELETE FROM classroom_feedback WHERE item_id=?`, [itId]);
      run(db, `DELETE FROM review_pool WHERE item_id=?`, [itId]);
    }
    run(db, `DELETE FROM classroom_sessions WHERE pack_id=?`, [id]);
    run(db, `DELETE FROM content_items WHERE pack_id=?`, [id]);
    run(db, `DELETE FROM word_packs WHERE id=?`, [id]);
  });
}

export function packItemCount(db: SqlJsDatabase, packId: string): number {
  const r = one<{ c: number }>(db, `SELECT COUNT(*) AS c FROM content_items WHERE pack_id=?`, [packId]);
  return r ? r.c : 0;
}

// ---------- 词条 ----------
export function itemList(db: SqlJsDatabase, packId: string): ContentItem[] {
  const rows = all<ItemRow>(db, `SELECT * FROM content_items WHERE pack_id=? ORDER BY sort ASC, created_at ASC`, [packId]);
  return rows.map(rowToItem);
}

export function itemGet(db: SqlJsDatabase, itemId: string): ContentItem | undefined {
  const r = one<ItemRow>(db, `SELECT * FROM content_items WHERE id=?`, [itemId]);
  return r ? rowToItem(r) : undefined;
}

export function itemInsert(db: SqlJsDatabase, item: ContentItem): void {
  run(db, INSERT_ITEM_SQL, itemToRow(item));
}

export function itemUpdate(db: SqlJsDatabase, item: ContentItem): void {
  run(db, UPDATE_ITEM_SQL, [
    item.sort, item.type, item.text, item.phonetic, item.partOfSpeech, item.meaningZh,
    item.definitionEn, item.example, safeStringify(item.audio), safeStringify(item.image),
    safeStringify(item.aiMeta), safeStringify(item.fieldState), item.verified ? 1 : 0,
    item.locked ? 1 : 0, item.updatedAt, item.id
  ]);
}

export function itemUpsert(db: SqlJsDatabase, item: ContentItem): void {
  const existing = itemGet(db, item.id);
  if (existing) itemUpdate(db, item);
  else itemInsert(db, item);
}

export function itemDelete(db: SqlJsDatabase, itemId: string): void {
  run(db, `DELETE FROM classroom_feedback WHERE item_id=?`, [itemId]);
  run(db, `DELETE FROM review_pool WHERE item_id=?`, [itemId]);
  run(db, `DELETE FROM content_items WHERE id=?`, [itemId]);
}

export function itemReplaceAll(db: SqlJsDatabase, packId: string, items: ContentItem[]): void {
  tx(db, () => {
    run(db, `DELETE FROM content_items WHERE pack_id=?`, [packId]);
    for (const it of items) itemInsert(db, it);
    run(db, `UPDATE word_packs SET updated_at=? WHERE id=?`, [Date.now(), packId]);
  });
}

/**
 * V4.1: 将 Draft 词条批量转为 Persistent 词条，主进程生成正式 UUID。
 * 事务原子写入；失败则全部回滚。
 * @returns { persistentIds, mapping } persistentIds[i] 对应 drafts[i]
 */
export interface AddDraftsResult {
  persistentIds: string[];
  /** draftId → persistentId 映射 */
  mapping: Record<string, string>;
}

export function itemsAddDrafts(db: SqlJsDatabase, packId: string, drafts: DraftSavePayload[]): AddDraftsResult {
  const persistentIds: string[] = [];
  const mapping: Record<string, string> = {};
  const now = Date.now();
  tx(db, () => {
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const pid = randomUUID();
      persistentIds.push(pid);
      // 使用 draftId 作为 key（若不存在则用索引兜底）
      const key = d.draftId || `draft_${i}`;
      mapping[key] = pid;
      const item: ContentItem = {
        id: pid,
        packId,
        sort: i,
        type: d.type,
        text: d.text,
        phonetic: d.phonetic,
        partOfSpeech: d.partOfSpeech,
        meaningZh: d.meaningZh,
        definitionEn: d.definitionEn,
        example: d.example,
        audio: d.audio,
        image: d.image as ContentItem["image"],
        aiMeta: d.aiMeta,
        fieldState: d.fieldState,
        verified: d.verified,
        locked: d.locked,
        createdAt: now,
        updatedAt: now
      };
      itemInsert(db, item);
    }
    // 校验数量
    const stmt = db.prepare("SELECT COUNT(*) AS c FROM content_items WHERE pack_id=?");
    stmt.bind([packId]);
    stmt.step();
    const cnt = (stmt.getAsObject().c as number) ?? 0;
    stmt.free();
    if (cnt !== drafts.length) {
      throw new Error(`itemsAddDrafts 校验失败：期望 ${drafts.length} 条，实际 ${cnt}`);
    }
  });
  return { persistentIds, mapping };
}

// ---------- 媒体 ----------
interface MediaRow {
  id: string; kind: string; filename: string; local_path: string;
  source_type: string; source_url: string; description: string;
  mime: string; meta_json: string; created_at: number;
}

export function mediaList(db: SqlJsDatabase, kind?: "image" | "audio"): MediaAsset[] {
  const rows = all<MediaRow>(
    db,
    kind ? `SELECT * FROM media_assets WHERE kind=? ORDER BY created_at DESC` : `SELECT * FROM media_assets ORDER BY created_at DESC`,
    kind ? [kind] : []
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind as MediaAsset["kind"], filename: r.filename, localPath: r.local_path,
    sourceType: r.source_type as MediaAsset["sourceType"], sourceUrl: r.source_url, description: r.description,
    mime: r.mime, meta: safeJsonParse(r.meta_json, {}), createdAt: r.created_at
  }));
}

export function mediaInsert(db: SqlJsDatabase, m: MediaAsset): void {
  run(db, `INSERT INTO media_assets (id,kind,filename,local_path,source_type,source_url,description,mime,meta_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [m.id, m.kind, m.filename, m.localPath, m.sourceType, m.sourceUrl || "", m.description || "", m.mime, safeStringify(m.meta || {}), m.createdAt]);
}

export function mediaDelete(db: SqlJsDatabase, id: string): MediaAsset | undefined {
  const r = one<MediaRow>(db, `SELECT * FROM media_assets WHERE id=?`, [id]);
  if (!r) return undefined;
  run(db, `DELETE FROM media_assets WHERE id=?`, [id]);
  return {
    id: r.id, kind: r.kind as MediaAsset["kind"], filename: r.filename, localPath: r.local_path,
    sourceType: r.source_type as MediaAsset["sourceType"], sourceUrl: r.source_url,
    description: r.description, mime: r.mime, meta: safeJsonParse(r.meta_json, {}), createdAt: r.created_at
  };
}

// ---------- 课堂 Session / 反馈 ----------
export function sessionCreate(db: SqlJsDatabase, s: ClassroomSession): void {
  run(db, `INSERT INTO classroom_sessions (id,pack_id,game_mode,class_name,started_at,item_count,correct_count,combo_max,summary_json)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [s.id, s.packId, s.gameMode, s.className, s.startedAt, s.itemCount, s.correctCount, s.comboMax, safeStringify(s.summary || {})]);
}

export function sessionUpdate(db: SqlJsDatabase, s: ClassroomSession): void {
  run(db, `UPDATE classroom_sessions SET ended_at=?, item_count=?, correct_count=?, combo_max=?, summary_json=?, game_mode=? WHERE id=?`,
    [s.endedAt || null, s.itemCount, s.correctCount, s.comboMax, safeStringify(s.summary || {}), s.gameMode, s.id]);
}

interface SessionRow {
  id: string; pack_id: string; game_mode: string; class_name: string;
  started_at: number; ended_at: number | null; item_count: number;
  correct_count: number; combo_max: number; summary_json: string;
}

function rowToSession(r: SessionRow): ClassroomSession {
  return {
    id: r.id, packId: r.pack_id, gameMode: r.game_mode, className: r.class_name,
    startedAt: r.started_at, endedAt: r.ended_at ?? undefined,
    itemCount: r.item_count, correctCount: r.correct_count, comboMax: r.combo_max,
    summary: safeJsonParse(r.summary_json, {})
  };
}

export function sessionList(db: SqlJsDatabase): ClassroomSession[] {
  return all<SessionRow>(db, `SELECT * FROM classroom_sessions ORDER BY started_at DESC`).map(rowToSession);
}

export function sessionGet(db: SqlJsDatabase, id: string): ClassroomSession | undefined {
  const r = one<SessionRow>(db, `SELECT * FROM classroom_sessions WHERE id=?`, [id]);
  return r ? rowToSession(r) : undefined;
}

export function feedbackUpsert(db: SqlJsDatabase, f: ClassroomFeedback): void {
  const existing = one<{ id: string }>(db, `SELECT id FROM classroom_feedback WHERE session_id=? AND item_id=?`, [f.sessionId, f.itemId]);
  if (existing) {
    run(db, `UPDATE classroom_feedback SET signal=?, response_count=?, correct_count=?, notes=?, created_at=? WHERE id=?`,
      [f.signal, f.responseCount, f.correctCount, f.notes, f.createdAt, existing.id]);
  } else {
    run(db, `INSERT INTO classroom_feedback (id,session_id,pack_id,item_id,signal,response_count,correct_count,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [f.id, f.sessionId, f.packId, f.itemId, f.signal, f.responseCount, f.correctCount, f.notes, f.createdAt]);
  }
}

export function feedbackListBySession(db: SqlJsDatabase, sessionId: string): ClassroomFeedback[] {
  return all<FeedbackRow>(db, `SELECT * FROM classroom_feedback WHERE session_id=?`, [sessionId]).map(rowToFeedback);
}

export function feedbackListByPack(db: SqlJsDatabase, packId: string): ClassroomFeedback[] {
  return all<FeedbackRow>(db, `SELECT * FROM classroom_feedback WHERE pack_id=? ORDER BY created_at DESC`, [packId]).map(rowToFeedback);
}

// ---------- 复习池 ----------
interface ReviewRow {
  id: string; pack_id: string; item_id: string; reason: string;
  source_session: string; last_mode: string; created_at: number; last_practiced: number | null;
}

function rowToReview(r: ReviewRow): ReviewEntry {
  return {
    id: r.id, packId: r.pack_id, itemId: r.item_id, reason: r.reason,
    sourceSession: r.source_session || undefined, lastMode: r.last_mode || undefined,
    createdAt: r.created_at, lastPracticed: r.last_practiced ?? undefined
  };
}

export function reviewList(db: SqlJsDatabase, packId?: string): ReviewEntry[] {
  const rows = all<ReviewRow>(
    db,
    packId ? `SELECT * FROM review_pool WHERE pack_id=? ORDER BY created_at DESC` : `SELECT * FROM review_pool ORDER BY created_at DESC`,
    packId ? [packId] : []
  );
  return rows.map(rowToReview);
}

export function reviewInsert(db: SqlJsDatabase, r: ReviewEntry): void {
  run(db, `INSERT INTO review_pool (id,pack_id,item_id,reason,source_session,last_mode,created_at,last_practiced)
    VALUES (?,?,?,?,?,?,?,?)`,
    [r.id, r.packId, r.itemId, r.reason, r.sourceSession || "", r.lastMode || "", r.createdAt, r.lastPracticed || null]);
}

export function reviewRemove(db: SqlJsDatabase, id: string): void {
  run(db, `DELETE FROM review_pool WHERE id=?`, [id]);
}

export function reviewClearPack(db: SqlJsDatabase, packId: string): void {
  run(db, `DELETE FROM review_pool WHERE pack_id=?`, [packId]);
}

// ---------- 设置 ----------
export function settingsGet(db: SqlJsDatabase, key: string): string {
  const r = one<{ value: string }>(db, `SELECT value FROM app_settings WHERE key=?`, [key]);
  return r ? r.value : "";
}

export function settingsSet(db: SqlJsDatabase, key: string, value: string): void {
  run(db, `INSERT INTO app_settings (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, value]);
}

export function aiSettingsGet(db: SqlJsDatabase, key: string): string {
  const r = one<{ value: string }>(db, `SELECT value FROM ai_provider_settings WHERE key=?`, [key]);
  return r ? r.value : "";
}

export function aiSettingsSet(db: SqlJsDatabase, key: string, value: string): void {
  run(db, `INSERT INTO ai_provider_settings (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, value]);
}

// ---------- 导出原始数据（用于备份） ----------
export interface DbDump {
  packs: WordPack[];
  items: ContentItem[];
  media: MediaAsset[];
  sessions: ClassroomSession[];
  feedback: ClassroomFeedback[];
  review: ReviewEntry[];
  settings: Record<string, string>;
}

interface FeedbackRow {
  id: string; session_id: string; pack_id: string; item_id: string; signal: string;
  response_count: number; correct_count: number; notes: string; created_at: number;
}

function rowToFeedback(r: FeedbackRow): ClassroomFeedback {
  return {
    id: r.id, sessionId: r.session_id, packId: r.pack_id, itemId: r.item_id,
    signal: r.signal as ClassroomFeedback["signal"],
    responseCount: r.response_count, correctCount: r.correct_count,
    notes: r.notes, createdAt: r.created_at
  };
}

export function dumpAll(db: SqlJsDatabase): DbDump {
  return {
    packs: all<PackRow>(db, `SELECT * FROM word_packs`).map(rowToPack),
    items: all<ItemRow>(db, `SELECT * FROM content_items`).map(rowToItem),
    media: mediaList(db),
    sessions: sessionList(db),
    feedback: all<FeedbackRow>(db, `SELECT * FROM classroom_feedback`).map(rowToFeedback),
    review: reviewList(db),
    settings: Object.fromEntries(
      all<{ key: string; value: string }>(db, `SELECT key, value FROM app_settings`).map((r) => [r.key, r.value])
    )
  };
}

export function restoreDump(db: SqlJsDatabase, dump: DbDump): void {
  tx(db, () => {
    db.run(`DELETE FROM word_packs`);
    db.run(`DELETE FROM content_items`);
    db.run(`DELETE FROM media_assets`);
    db.run(`DELETE FROM classroom_sessions`);
    db.run(`DELETE FROM classroom_feedback`);
    db.run(`DELETE FROM review_pool`);
    db.run(`DELETE FROM app_settings`);
    for (const p of dump.packs) packCreate(db, p);
    for (const it of dump.items) itemInsert(db, it);
    for (const m of dump.media) mediaInsert(db, m);
    for (const s of dump.sessions) sessionCreate(db, s);
    for (const f of dump.feedback) {
      run(db, `INSERT INTO classroom_feedback (id,session_id,pack_id,item_id,signal,response_count,correct_count,notes,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        [f.id, f.sessionId, f.packId, f.itemId, f.signal, f.responseCount, f.correctCount, f.notes, f.createdAt]);
    }
    for (const r of dump.review) reviewInsert(db, r);
    for (const [k, v] of Object.entries(dump.settings)) settingsSet(db, k, v);
  });
}

export interface AppAiSettings {
  config: AiProviderConfig;
  /** 不返回明文 Key */
  apiKeyEncrypted: boolean;
}

export function readAiConfig(db: SqlJsDatabase): AiProviderConfig {
  const raw = aiSettingsGet(db, "config");
  if (!raw) return defaultAiConfig();
  return { ...defaultAiConfig(), ...safeJsonParse(raw, defaultAiConfig()) };
}

export function defaultAiConfig(): AiProviderConfig {
  return {
    mode: "cloud",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    textModel: "gpt-4o-mini",
    imageModel: "dall-e-3",
    dictionary: "auto",
    advanced: {
      useIndependentText: false,
      useIndependentImage: false,
      useIndependentDictionary: false,
      text: { baseUrl: "", provider: "", model: "", hasKey: false },
      image: { baseUrl: "", provider: "", model: "", hasKey: false },
      dictionary: { baseUrl: "", provider: "", model: "", hasKey: false }
    },
    hasKey: false
  };
}
