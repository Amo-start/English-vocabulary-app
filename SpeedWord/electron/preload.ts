// 极速识词 V4 · preload 安全边界
// 通过 contextBridge 暴露最小白名单 IPC；渲染进程无 Node.js 能力、不接触明文 API Key。
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { SpeedWordApi } from "../src/shared/api";

const api: SpeedWordApi = {
  // 词包
  packsList: () => ipcRenderer.invoke("packs:list"),
  packCreate: (name: string, description: string) => ipcRenderer.invoke("packs:create", name, description),
  packUpdate: (id: string, name: string, description: string) => ipcRenderer.invoke("packs:update", id, name, description),
  packDelete: (id: string) => ipcRenderer.invoke("packs:delete", id),
  // 词条
  itemsList: (packId: string) => ipcRenderer.invoke("items:list", packId),
  itemGet: (id: string) => ipcRenderer.invoke("items:get", id),
  itemSave: (item: unknown) => ipcRenderer.invoke("items:save", item),
  itemDelete: (id: string) => ipcRenderer.invoke("items:delete", id),
  itemsReplaceAll: (packId: string, items: unknown[]) => ipcRenderer.invoke("items:replaceAll", packId, items),
  // 媒体
  mediaList: (kind?: string) => ipcRenderer.invoke("media:list", kind),
  mediaRegister: (m: unknown) => ipcRenderer.invoke("media:register", m),
  mediaDelete: (id: string) => ipcRenderer.invoke("media:delete", id),
  // 课堂
  sessionsList: () => ipcRenderer.invoke("sessions:list"),
  sessionCreate: (s: unknown) => ipcRenderer.invoke("sessions:create", s),
  sessionUpdate: (s: unknown) => ipcRenderer.invoke("sessions:update", s),
  feedbackUpsert: (f: unknown) => ipcRenderer.invoke("feedback:upsert", f),
  feedbackBySession: (sessionId: string) => ipcRenderer.invoke("feedback:bySession", sessionId),
  feedbackByPack: (packId: string) => ipcRenderer.invoke("feedback:byPack", packId),
  // 复习池
  reviewList: (packId?: string) => ipcRenderer.invoke("review:list", packId),
  reviewAdd: (r: unknown) => ipcRenderer.invoke("review:add", r),
  reviewRemove: (id: string) => ipcRenderer.invoke("review:remove", id),
  reviewClearPack: (packId: string) => ipcRenderer.invoke("review:clearPack", packId),
  // 设置
  settingsGet: (key: string) => ipcRenderer.invoke("settings:get", key),
  settingsSet: (key: string, value: string) => ipcRenderer.invoke("settings:set", key, value),
  // AI 配置（不返回明文 Key）
  aiGetConfig: () => ipcRenderer.invoke("ai:getConfig"),
  aiSetConfig: (config: unknown, keys?: Record<string, string>) => ipcRenderer.invoke("ai:setConfig", config, keys),
  aiTest: () => ipcRenderer.invoke("ai:test"),
  aiLookupDict: (text: string) => ipcRenderer.invoke("ai:lookupDict", text),
  aiEnrichItems: (texts: Array<{ text: string; type?: string }>, opts?: { offlineOnly?: boolean }) =>
    ipcRenderer.invoke("ai:enrichItems", texts, opts),
  aiRegenField: (item: unknown, field: string) => ipcRenderer.invoke("ai:regenField", item, field),
  aiRegenImageByDescription: (item: unknown, description: string) => ipcRenderer.invoke("ai:regenImageByDescription", item, description),
  // 图片
  imagePickAndImport: () => ipcRenderer.invoke("image:pickAndImport"),
  imageSearch: (query: string) => ipcRenderer.invoke("image:search", query),
  imageApplyApi: (thumbUrl: string, pageUrl: string, description: string) => ipcRenderer.invoke("image:applyApi", thumbUrl, pageUrl, description),
  // 音频
  audioDownload: (url: string) => ipcRenderer.invoke("audio:download", url),
  // 备份
  backupExportPack: (packId: string) => ipcRenderer.invoke("backup:exportPack", packId),
  backupImportPack: () => ipcRenderer.invoke("backup:importPack"),
  backupExportFull: () => ipcRenderer.invoke("backup:exportFull"),
  backupImportFull: () => ipcRenderer.invoke("backup:importFull"),
  // 事件订阅（智能补全进度）
  onEnrichProgress: (cb: (p: { done: number; total: number; current: string }) => void) => {
    const listener = (_e: IpcRendererEvent, p: { done: number; total: number; current: string }) => cb(p);
    ipcRenderer.on("enrich:progress", listener);
    return () => ipcRenderer.removeListener("enrich:progress", listener);
  },
  // 应用
  appVersion: () => ipcRenderer.invoke("app:version")
};

contextBridge.exposeInMainWorld("api", api);
