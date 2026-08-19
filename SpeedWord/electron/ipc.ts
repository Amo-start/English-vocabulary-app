// IPC 白名单：渲染进程只能通过这些通道访问主进程能力。
// API Key 明文永不跨过 preload 边界。
import { ipcMain, dialog, BrowserWindow, app } from "electron";
import type { Db } from "./db";
import {
  packList, packGet, packCreate, packUpdate, packDelete,
  itemList, itemGet, itemInsert, itemUpdate, itemDelete, itemReplaceAll,
  mediaList, mediaInsert, mediaDelete,
  sessionCreate, sessionUpdate, sessionList,
  feedbackUpsert, feedbackListBySession, feedbackListByPack,
  reviewList, reviewInsert, reviewRemove, reviewClearPack,
  settingsGet, settingsSet, aiSettingsGet, aiSettingsSet, readAiConfig, defaultAiConfig, dumpAll, restoreDump,
  type DbDump
} from "./db";
import { setSecret, getSecret, hasSecret, type KeySlot } from "./secure-store";
import { enrichItems, regenerateField } from "./enrich";
import { dictionaryService } from "./dictionary";
import { searchImageApi, cacheApiImage, generateImage, importUserImage, builtinUrl } from "./images";
import { resolveAiCfg, OpenAiCompatibleImage, testConnection, testImageConnection } from "./ai";
import { exportPack, importPack, exportFullBackup } from "./backup";
import { uid } from "../src/shared/uuid";
import { mediaDir, httpGet, safeStringify } from "./util";
import type { ContentItem, MediaAsset, ClassroomSession, ClassroomFeedback, ReviewEntry, AiProviderConfig } from "../src/shared/types";
import path from "node:path";
import fs from "node:fs";

export function registerIpc(db: Db): void {
  const send = (channel: string, payload: unknown) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  // ---------- 词包 ----------
  ipcMain.handle("packs:list", () => packList(db.db));
  ipcMain.handle("packs:create", (_e, name: string, description: string) => {
    const now = Date.now();
    const pack = { id: uid("pack"), name: name?.trim() || "未命名词包", description: description || "", version: 1, itemCount: 0, createdAt: now, updatedAt: now };
    packCreate(db.db, pack);
    db.save();
    return pack;
  });
  ipcMain.handle("packs:update", (_e, id: string, name: string, description: string) => {
    packUpdate(db.db, id, name, description);
    db.save();
    return packGet(db.db, id);
  });
  ipcMain.handle("packs:delete", (_e, id: string) => {
    packDelete(db.db, id);
    db.save();
    return { ok: true };
  });

  // ---------- 词条 ----------
  ipcMain.handle("items:list", (_e, packId: string) => itemList(db.db, packId));
  ipcMain.handle("items:get", (_e, id: string) => itemGet(db.db, id));
  ipcMain.handle("items:save", (_e, item: ContentItem) => {
    if (item.id && itemGet(db.db, item.id)) itemUpdate(db.db, item);
    else itemInsert(db.db, item);
    db.save();
    return itemGet(db.db, item.id);
  });
  ipcMain.handle("items:delete", (_e, id: string) => {
    itemDelete(db.db, id);
    db.save();
    return { ok: true };
  });
  ipcMain.handle("items:replaceAll", (_e, packId: string, items: ContentItem[]) => {
    itemReplaceAll(db.db, packId, items);
    db.save();
    return { ok: true, count: items.length };
  });

  // ---------- 媒体 ----------
  ipcMain.handle("media:list", (_e, kind?: "image" | "audio") => mediaList(db.db, kind));
  ipcMain.handle("media:register", (_e, m: MediaAsset) => {
    mediaInsert(db.db, m);
    db.save();
    return m;
  });
  ipcMain.handle("media:delete", (_e, id: string) => {
    const m = mediaDelete(db.db, id);
    db.save();
    return m;
  });

  // ---------- 课堂 ----------
  ipcMain.handle("sessions:list", () => sessionList(db.db));
  ipcMain.handle("sessions:create", (_e, s: ClassroomSession) => { sessionCreate(db.db, s); db.save(); return s; });
  ipcMain.handle("sessions:update", (_e, s: ClassroomSession) => { sessionUpdate(db.db, s); db.save(); return s; });
  ipcMain.handle("feedback:upsert", (_e, f: ClassroomFeedback) => { feedbackUpsert(db.db, f); db.save(); return f; });
  ipcMain.handle("feedback:bySession", (_e, sessionId: string) => feedbackListBySession(db.db, sessionId));
  ipcMain.handle("feedback:byPack", (_e, packId: string) => feedbackListByPack(db.db, packId));

  // ---------- 复习池 ----------
  ipcMain.handle("review:list", (_e, packId?: string) => reviewList(db.db, packId));
  ipcMain.handle("review:add", (_e, r: ReviewEntry) => { reviewInsert(db.db, r); db.save(); return r; });
  ipcMain.handle("review:remove", (_e, id: string) => { reviewRemove(db.db, id); db.save(); return { ok: true }; });
  ipcMain.handle("review:clearPack", (_e, packId: string) => { reviewClearPack(db.db, packId); db.save(); return { ok: true }; });

  // ---------- 设置 ----------
  ipcMain.handle("settings:get", (_e, key: string) => settingsGet(db.db, key));
  ipcMain.handle("settings:set", (_e, key: string, value: string) => { settingsSet(db.db, key, value); db.save(); return { ok: true }; });

  // ---------- AI 设置（不含明文 Key） ----------
  ipcMain.handle("ai:getConfig", (): AiProviderConfig => {
    const c = readAiConfig(db.db);
    return {
      ...c,
      hasKey: hasSecret(db, "main"),
      advanced: {
        ...c.advanced,
        text: { ...c.advanced.text, hasKey: hasSecret(db, "text") },
        image: { ...c.advanced.image, hasKey: hasSecret(db, "image") },
        dictionary: { ...c.advanced.dictionary, hasKey: hasSecret(db, "dictionary") }
      }
    };
  });
  ipcMain.handle("ai:setConfig", (_e, config: AiProviderConfig, keys?: { main?: string; text?: string; image?: string; dictionary?: string }) => {
    // 只存非密钥配置
    aiSettingsSet(db.db, "config", safeStringify(config));
    // 密钥单独加密存储
    if (keys) {
      const slots: Array<[KeySlot, string | undefined]> = [
        ["main", keys.main], ["text", keys.text], ["image", keys.image], ["dictionary", keys.dictionary]
      ];
      for (const [slot, v] of slots) {
        if (v !== undefined) setSecret(db, slot, v);
      }
    }
    db.save();
    return { ok: true };
  });
  ipcMain.handle("ai:test", async () => {
    const c = readAiConfig(db.db);
    const secrets = {
      main: getSecret(db, "main"), text: getSecret(db, "text"),
      image: getSecret(db, "image"), dictionary: getSecret(db, "dictionary")
    };
    const cfg = resolveAiCfg(c, secrets);
    const text = await testConnection(cfg.text);
    const image = cfg.image.enabled ? await testImageConnection(cfg.image) : { ok: true, message: "未配置图片服务（可跳过）" };
    return { text, image };
  });
  ipcMain.handle("ai:lookupDict", async (_e, text: string) => {
    const entry = await dictionaryService.lookup(text);
    return entry;
  });

  // ---------- 智能补全 ----------
  ipcMain.handle("ai:enrichItems", async (_e, texts: Array<{ text: string; type?: ContentItem["type"] }>, opts?: { offlineOnly?: boolean }) => {
    const results = await enrichItems(db, texts, {
      offlineOnly: opts?.offlineOnly,
      onProgress: (done, total, current) => send("enrich:progress", { done, total, current })
    });
    return results;
  });
  ipcMain.handle("ai:regenField", async (_e, item: ContentItem, field: string) => {
    const patch = await regenerateField(db, item, field as never);
    return patch;
  });
  ipcMain.handle("ai:regenImageByDescription", async (_e, item: ContentItem, description: string) => {
    const c = readAiConfig(db.db);
    const secrets = { main: getSecret(db, "main"), text: getSecret(db, "text"), image: getSecret(db, "image"), dictionary: getSecret(db, "dictionary") };
    const cfg = resolveAiCfg(c, secrets);
    if (!cfg.image.enabled) throw new Error("AI 图片服务未配置");
    const gen = await generateImage(new OpenAiCompatibleImage({
      baseUrl: cfg.image.baseUrl, apiKey: cfg.image.apiKey, model: cfg.image.model, provider: cfg.image.provider
    }), description);
    return gen;
  });

  // ---------- 图片操作 ----------
  ipcMain.handle("image:pickAndImport", async (): Promise<{ ok: boolean; result?: { localPath: string; filename: string; sourceType: string; description?: string }; message?: string }> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "选择图片",
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] }],
      properties: ["openFile"]
    });
    if (canceled || !filePaths?.[0]) return { ok: false, message: "已取消" };
    try {
      const result = await importUserImage(filePaths[0]);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  ipcMain.handle("image:search", async (_e, query: string) => {
    return searchImageApi(query, 8);
  });
  ipcMain.handle("image:applyApi", async (_e, thumbUrl: string, pageUrl: string, description: string) => {
    return cacheApiImage(thumbUrl, pageUrl, description);
  });

  // ---------- 音频 ----------
  ipcMain.handle("audio:download", async (_e, url: string): Promise<{ ok: boolean; localPath?: string; message?: string }> => {
    try {
      const dir = mediaDir("audio");
      const buf = await httpGet(url, 20000);
      const file = `aud_${Date.now().toString(36)}.mp3`;
      fs.writeFileSync(path.join(dir, file), buf);
      return { ok: true, localPath: path.join(dir, file) };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });

  // ---------- 备份 ----------
  ipcMain.handle("backup:exportPack", async (_e, packId: string) => exportPack(db, packId));
  ipcMain.handle("backup:importPack", async () => importPack(db));
  ipcMain.handle("backup:exportFull", async () => exportFullBackup(db));

  // ---------- 全库导入（设置恢复） ----------
  ipcMain.handle("backup:importFull", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "导入整库备份",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    });
    if (canceled || !filePaths?.[0]) return { ok: false, message: "已取消" };
    try {
      const raw = fs.readFileSync(filePaths[0], "utf8");
      const data = JSON.parse(raw) as { format?: string; data?: DbDump };
      const dump = data.data || (data as unknown as DbDump);
      if (!Array.isArray(dump.packs)) throw new Error("备份格式错误");
      restoreDump(db.db, dump);
      db.save();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: `导入失败：${(e as Error).message}` };
    }
  });

  // ---------- 应用信息 ----------
  ipcMain.handle("app:version", () => app.getVersion());
}
