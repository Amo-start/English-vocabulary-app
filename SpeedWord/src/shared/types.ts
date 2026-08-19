// ============ V4 共享数据类型（渲染端 / 主进程 / 测试共用） ============

/** 内容类型：单词 / 词组 / 短语动词 / 句子 / 习语表达 */
export type ContentType =
  | "word"
  | "phrase"
  | "phrasal_verb"
  | "sentence"
  | "expression";

/** 单字段人工状态 */
export type FieldStateValue = "auto" | "edited" | "locked";

/** 字段级人工状态 */
export interface FieldState {
  phonetic: FieldStateValue;
  meaningZh: FieldStateValue;
  definitionEn: FieldStateValue;
  example: FieldStateValue;
  image: FieldStateValue;
  audio: FieldStateValue;
}

/** 图片来源类型 */
export type ImageSourceType = "builtin" | "api" | "ai" | "user";

/** 图片历史版本 */
export interface ImageHistoryEntry {
  localPath: string;
  sourceType: ImageSourceType;
  sourceUrl?: string;
  description?: string;
  at: number;
}

/** 图片数据 */
export interface ItemImage {
  localPath: string;
  sourceType: ImageSourceType;
  sourceUrl?: string;
  description?: string;
  status: "ok" | "generating" | "failed";
  locked: boolean;
  history: ImageHistoryEntry[];
}

/** 音频数据 */
export interface ItemAudio {
  url?: string;
  localPath?: string;
  source: "tts" | "dict" | "user" | "none";
  status: "ok" | "loading" | "failed" | "none";
}

/** AI 元数据 */
export interface AiMeta {
  generatedBy: "local" | "dict-api" | "ai" | "none";
  generatedAt: number;
  promptVersion?: string;
  provider?: string;
  model?: string;
  /** 记忆提示（教学辅助） */
  memoryHint?: string;
  /** 图片场景描述（AI 生成图片用） */
  imageDescription?: string;
}

/** 词条（V4 核心实体：word / phrase / phrasal_verb / sentence / expression） */
export interface ContentItem {
  id: string;
  packId: string;
  sort: number;
  type: ContentType;
  /** 英文文本（教师唯一必填项） */
  text: string;
  phonetic: string;
  partOfSpeech: string;
  meaningZh: string;
  definitionEn: string;
  example: string;
  audio: ItemAudio;
  image: ItemImage;
  aiMeta: AiMeta;
  fieldState: FieldState;
  /** 教师是否已人工核对过 */
  verified: boolean;
  /** 词条整体锁定：任何自动补全都不得覆盖 */
  locked: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 词包 */
export interface WordPack {
  id: string;
  name: string;
  description: string;
  version: number;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 媒体素材（图片库 / 音频库） */
export interface MediaAsset {
  id: string;
  kind: "image" | "audio";
  filename: string;
  localPath: string;
  sourceType: ImageSourceType | "tts";
  sourceUrl?: string;
  description?: string;
  mime: string;
  createdAt: number;
  meta?: Record<string, unknown>;
}

/** 课堂反馈：课堂 Session 级，不绑定词条永久状态 */
export type FeedbackSignal = "mastered" | "partial" | "review" | "unrated";

export interface ClassroomFeedback {
  id: string;
  sessionId: string;
  packId: string;
  itemId: string;
  signal: FeedbackSignal;
  responseCount: number;
  correctCount: number;
  notes: string;
  createdAt: number;
}

/** 课堂 Session */
export interface ClassroomSession {
  id: string;
  packId: string;
  gameMode: string;
  className: string;
  startedAt: number;
  endedAt?: number;
  itemCount: number;
  correctCount: number;
  comboMax: number;
  summary?: Record<string, unknown>;
}

/** 复习池条目 */
export interface ReviewEntry {
  id: string;
  packId: string;
  itemId: string;
  reason: string;
  sourceSession?: string;
  lastMode?: string;
  createdAt: number;
  lastPracticed?: number;
}

/** AI Provider 配置（不含明文 Key） */
export interface AiProviderConfig {
  mode: "off" | "cloud" | "local";
  provider: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  dictionary: "auto" | "off";
  /** 高级：独立配置 */
  advanced: {
    useIndependentText: boolean;
    useIndependentImage: boolean;
    useIndependentDictionary: boolean;
    text: { baseUrl: string; provider: string; model: string; hasKey: boolean };
    image: { baseUrl: string; provider: string; model: string; hasKey: boolean };
    dictionary: { baseUrl: string; provider: string; model: string; hasKey: boolean };
  };
  /** 是否已配置主 Key（明文永不返回给渲染端） */
  hasKey: boolean;
}

/** 错误结果（按词条收集，允许单条失败不影响整体） */
export interface EnrichError {
  stage: "dictionary" | "text-ai" | "image" | "audio";
  message: string;
}

/** 智能补全单项结果 */
export interface EnrichResult {
  item: ContentItem;
  errors: EnrichError[];
  source: {
    phonetic: "builtin" | "dict-api" | "ai" | "none";
    meaningZh: "ai" | "none";
    definitionEn: "dict-api" | "ai" | "none";
    example: "ai" | "dict-api" | "none";
    image: ImageSourceType | "none";
  };
}

/** 游戏模式 */
export type GameMode =
  | "quick-read"     // 快速识词
  | "picture-guess"  // 看图猜词
  | "choice"         // 选择挑战
  | "en2zh"          // 英译中
  | "zh2en"          // 中译英
  | "context"        // 情境猜词
  | "random"         // 随机挑战
  | "flash-recall";  // 翻牌（保留）

export interface GameModeMeta {
  id: GameMode;
  label: string;
  emoji: string;
  desc: string;
}

export const GAME_MODES: GameModeMeta[] = [
  { id: "quick-read", label: "快速识词", emoji: "⚡", desc: "屏幕大字 → 学生回忆 → 显示答案" },
  { id: "picture-guess", label: "看图猜词", emoji: "🖼️", desc: "图片 → 抢答词语 → 显示答案" },
  { id: "choice", label: "选择挑战", emoji: "🎯", desc: "问题 + 3~4 选项 → 选择 → 反馈" },
  { id: "en2zh", label: "英译中", emoji: "🇬🇧", desc: "看英文 → 抢答中文含义" },
  { id: "zh2en", label: "中译英", emoji: "🇨🇳", desc: "看中文 → 抢答英文" },
  { id: "context", label: "情境猜词", emoji: "🧩", desc: "简短场景/句子 → 猜目标词" },
  { id: "random", label: "随机挑战", emoji: "🎲", desc: "词、图、释义、例句混合随机" },
  { id: "flash-recall", label: "翻牌记忆", emoji: "🃏", desc: "经典翻牌：先回忆后揭晓" }
];

/** 课堂状态机 */
export type ClassroomPhase =
  | "IDLE"
  | "QUESTION_READY"
  | "ANSWER_REVEALING"
  | "ANSWER_VISIBLE"
  | "FEEDBACK"
  | "QUESTION_TRANSITIONING"
  | "FINISHED";

export const PHASE_LABEL: Record<ClassroomPhase, string> = {
  IDLE: "就绪",
  QUESTION_READY: "出题",
  ANSWER_REVEALING: "揭示中",
  ANSWER_VISIBLE: "答案可见",
  FEEDBACK: "反馈",
  QUESTION_TRANSITIONING: "过渡中",
  FINISHED: "已完成"
};
