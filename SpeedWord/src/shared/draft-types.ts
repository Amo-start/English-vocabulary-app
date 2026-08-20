// Draft 内容项：仅用于智能创建预览阶段，不直接落库
// 与持久化 ContentItem 的区别：draftId 是前端临时 ID，persistentId 由主进程在保存时生成 UUID
import type { ContentType, FieldState, ItemAudio, AiMeta, ImageSourceType } from "./types";

export type DraftImageSource = Extract<ImageSourceType, "api" | "ai" | "legacy_builtin" | "user"> | "none";

/** 图片数据（Draft 阶段使用） */
export interface DraftImage {
  localPath: string;
  sourceType: DraftImageSource;
  sourceUrl?: string;
  description?: string;
  /** ok | generating | failed */
  status: "ok" | "generating" | "failed";
  locked: boolean;
  history: Array<{ localPath: string; sourceType: DraftImageSource; at: number }>;
}

/** 智能创建阶段的词条（draft 状态，ID 仅前端使用） */
export interface DraftContentItem {
  /** 前端临时 ID（格式 draft_xxx），仅用于本会话内的引用 */
  draftId: string;
  type: ContentType;
  text: string;
  phonetic: string;
  partOfSpeech: string;
  meaningZh: string;
  definitionEn: string;
  example: string;
  audio: ItemAudio;
  image: DraftImage;
  aiMeta: AiMeta;
  fieldState: FieldState;
  verified: boolean;
  locked: boolean;
  /** 错误信息（单条词条级，不影响其他词条） */
  errors?: Array<{ stage: string; message: string }>;
}

/** 保存到主进程时的 Plain DTO（不包含 draftId，不含 Vue Proxy） */
export interface DraftSavePayload {
  /** 前端临时 ID，用于返回后更新本地状态 */
  draftId: string;
  type: ContentType;
  text: string;
  phonetic: string;
  partOfSpeech: string;
  meaningZh: string;
  definitionEn: string;
  example: string;
  audio: ItemAudio;
  image: {
    localPath: string;
    sourceType: DraftImageSource;
    sourceUrl?: string;
    description?: string;
    status: "ok" | "generating" | "failed";
    locked: boolean;
    history: Array<{ localPath: string; sourceType: string; at: number }>;
  };
  aiMeta: AiMeta;
  fieldState: FieldState;
  verified: boolean;
  locked: boolean;
}
