// preload 暴露给渲染进程的 API 接口类型（主进程实现）。
// 渲染进程只依赖此类型；明文 Key 永不跨越此边界。
import type {
  ContentItem, WordPack, MediaAsset, ClassroomSession, ClassroomFeedback,
  ReviewEntry, AiProviderConfig, EnrichResult
} from "./types";
import type { DraftSavePayload } from "./draft-types";

export interface EnrichRequestItem {
  text: string;
  type?: ContentItem["type"];
}

export interface EnrichProgress {
  done: number;
  total: number;
  current: string;
}

export interface ImageSearchHit {
  thumbUrl: string;
  pageUrl: string;
  title: string;
}

export interface AppliedImage {
  localPath: string;
  filename: string;
  sourceType: string;
  sourceUrl?: string;
  description?: string;
}

// ---- AI 服务配置链（electronAPI.ai.*，全 Structured-Clone 安全纯数据） ----

/** 单个服务（文本/图片）真实测试结果 */
export interface ServiceTestResult {
  service: "text" | "image";
  success: boolean;
  /** 结果码：ok / ai_not_configured / ai_no_key / ai_http / ai_network / ai_dns / ai_timeout / ai_connect / ai_tls / ai_empty / ai_parse ... */
  code: string;
  message: string;
  /** HTTP 状态码（有则填） */
  status?: number;
  /** 实际请求端点 */
  endpoint?: string;
  model?: string;
  durationMs: number;
  suggestion?: string;
}

export interface AiGenerateTextResult {
  success: boolean;
  text?: string;
  model?: string;
  code?: string;
  message?: string;
  status?: number;
  suggestion?: string;
}

export interface AiGenerateImageResult {
  success: boolean;
  url?: string;
  b64?: string;
  model?: string;
  code?: string;
  message?: string;
  status?: number;
  suggestion?: string;
}

export interface AiSaveConfigResult {
  ok: boolean;
  /** 保存后的实际配置（含 hasKey 状态，用于前端回读校验） */
  config: AiProviderConfig;
}

/** electronAPI.ai 命名空间：AI 配置链专用，永不暴露 ipcRenderer */
export interface ElectronAiApi {
  saveConfig(config: AiProviderConfig, keys?: Record<string, string>): Promise<AiSaveConfigResult>;
  getConfig(): Promise<AiProviderConfig>;
  testText(): Promise<ServiceTestResult>;
  testImage(): Promise<ServiceTestResult>;
  generateText(prompt: string, opts?: { temperature?: number; json?: boolean }): Promise<AiGenerateTextResult>;
  generateImage(prompt: string): Promise<AiGenerateImageResult>;
}

export interface ElectronApi {
  ai: ElectronAiApi;
}

export interface SpeedWordApi {
  // 词包
  packsList(): Promise<WordPack[]>;
  packCreate(name: string, description: string): Promise<WordPack>;
  packUpdate(id: string, name: string, description: string): Promise<WordPack | undefined>;
  packDelete(id: string): Promise<{ ok: boolean }>;
  // 词条
  itemsList(packId: string): Promise<ContentItem[]>;
  itemGet(id: string): Promise<ContentItem | undefined>;
  itemSave(item: ContentItem): Promise<ContentItem | undefined>;
  itemDelete(id: string): Promise<{ ok: boolean }>;
  itemsReplaceAll(packId: string, items: ContentItem[]): Promise<{ ok: boolean; count: number }>;
  // V4.1: Draft→Persistent 批量保存（主进程生成正式 UUID）
  itemsAddDrafts(packId: string, drafts: DraftSavePayload[]): Promise<{ persistentIds: string[]; mapping: Record<string, string> }>;
  // 媒体
  mediaList(kind?: "image" | "audio"): Promise<MediaAsset[]>;
  mediaRegister(m: MediaAsset): Promise<MediaAsset>;
  mediaDelete(id: string): Promise<MediaAsset | undefined>;
  // 课堂
  sessionsList(): Promise<ClassroomSession[]>;
  sessionCreate(s: ClassroomSession): Promise<ClassroomSession>;
  sessionUpdate(s: ClassroomSession): Promise<ClassroomSession>;
  feedbackUpsert(f: ClassroomFeedback): Promise<ClassroomFeedback>;
  feedbackBySession(sessionId: string): Promise<ClassroomFeedback[]>;
  feedbackByPack(packId: string): Promise<ClassroomFeedback[]>;
  // 复习池
  reviewList(packId?: string): Promise<ReviewEntry[]>;
  reviewAdd(r: ReviewEntry): Promise<ReviewEntry>;
  reviewRemove(id: string): Promise<{ ok: boolean }>;
  reviewClearPack(packId: string): Promise<{ ok: boolean }>;
  // 设置
  settingsGet(key: string): Promise<string>;
  settingsSet(key: string, value: string): Promise<{ ok: boolean }>;
  // AI 配置（无明文 Key）
  aiGetConfig(): Promise<AiProviderConfig>;
  aiSetConfig(config: AiProviderConfig, keys?: Record<string, string>): Promise<{ ok: boolean }>;
  aiTest(): Promise<{ text: { ok: boolean; message: string }; image: { ok: boolean; message: string } }>;
  aiLookupDict(text: string): Promise<unknown>;
  aiEnrichItems(texts: EnrichRequestItem[], opts?: { offlineOnly?: boolean }): Promise<EnrichResult[]>;
  aiRegenField(item: ContentItem, field: string): Promise<Partial<ContentItem>>;
  aiRegenImageByDescription(item: ContentItem, description: string): Promise<AppliedImage>;
  /** contentId-only 重新生成图片（避免传整个词条对象触发 DataCloneError） */
  imageRegenerate(params: { contentId: string; customInstruction?: string }): Promise<AppliedImage>;
  // 图片
  imagePickAndImport(): Promise<{ ok: boolean; result?: AppliedImage; message?: string }>;
  imageSearch(query: string): Promise<ImageSearchHit[]>;
  imageApplyApi(thumbUrl: string, pageUrl: string, description: string): Promise<AppliedImage>;
  // 音频
  audioDownload(url: string): Promise<{ ok: boolean; localPath?: string; message?: string }>;
  // 备份
  backupExportPack(packId: string): Promise<{ ok: boolean; path?: string; message?: string }>;
  backupImportPack(): Promise<{ ok: boolean; packId?: string; packName?: string; message?: string }>;
  backupExportFull(): Promise<{ ok: boolean; path?: string; message?: string }>;
  backupImportFull(): Promise<{ ok: boolean; message?: string }>;
  // 事件
  onEnrichProgress(cb: (p: EnrichProgress) => void): () => void;
  // 应用
  appVersion(): Promise<string>;
}
