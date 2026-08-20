// 智能补全编排：词典 → AI 教学化 → 场景描述生成 → AI 图片
// V4.1 重构：
//   1. builtin 降级为 legacy_builtin，仅离线兜底
//   2. AI 图片优先，使用 SceneGenerator 先生成场景描述再绘图（避免词汇原文出现在图片中）
//   3. 图片失败不阻塞核心保存
import { DictionaryService, dictionaryService, type DictEntry } from "./dictionary";
import {
  collectResolvedCfg, OpenAiCompatibleText, OpenAiCompatibleImage, parseModelJson, AiError,
  type ResolvedAiCfg
} from "./ai";
import {
  findBuiltinImage, searchImageApi, generateImage, cacheApiImage, builtinUrl
} from "./images";
import type { Db } from "./db";
import { detectContentType, typeLabel } from "../src/shared/type-detect";
import { uid } from "../src/shared/uuid";
import { EMPTY_FIELD_STATE } from "../src/shared/fieldstate";
import type { ContentItem, EnrichError, EnrichResult } from "../src/shared/types";
import { httpGet } from "./util";
import { buildImagePrompt, buildFallbackImagePrompt, generateVisualScene, type VisualScene } from "./image-prompt-builder";

export interface EnrichOpts {
  /** 是否跳过在线词典与 AI（纯离线基础补全） */
  offlineOnly?: boolean;
  /** 并发上限 */
  concurrency?: number;
  onProgress?: (done: number, total: number, currentText: string) => void;
}

export interface EnrichRequestItem {
  text: string;
  type?: ContentItem["type"];
}

const DEFAULT_CONCURRENCY = 3;

// ---------- AI 教学化 ----------
interface AiEnrichPayload {
  meaningZh: string;
  definitionEn: string;
  example: string;
  memoryHint: string;
  /** 图片场景描述（AI 生成，不含词汇原文，用于图片生成） */
  imageSceneDescription: string;
}

const SYSTEM_PROMPT = `你是经验丰富的初中英语教师，负责把英文词条加工成适合中国学生课堂使用的教学素材。
规则：
1. meaningZh：简洁准确的中文解释（一词条一行，含适用语境）。
2. definitionEn：给初中生看的英文释义，用简单词。
3. example：一个自然、课堂可用的英文例句（配中文对照放 example 即可，格式 "英文. 中文。"）。
4. memoryHint：帮助学生记忆的提示（联想/词根/谐音，中文）。
5. imageSceneDescription：一段纯英文的场景描述，用于生成"教学情境插画"。
   - 描述必须是具体的视觉画面（人物、动作、物体、场景），不能包含目标词汇本身。
   - 例如 protect → "A school-age child stands bravely in front of a small puppy, holding an umbrella over the dog to shield it from rain."
   - 要求：主体明确、背景干净、画面无任何文字、适合教室大屏投影，50词以内。
只输出一个 JSON 对象，不要输出任何其他文字。`;

function buildAiUserPrompt(item: string, type: string): string {
  return `词条：${item}
类型：${typeLabel(type as ContentItem["type"])}
请按系统要求返回 JSON。`;
}

async function enrichWithAi(
  textCfg: ResolvedAiCfg["text"],
  item: string,
  type: ContentItem["type"]
): Promise<AiEnrichPayload> {
  const provider = new OpenAiCompatibleText({
    baseUrl: textCfg.baseUrl, apiKey: textCfg.apiKey, model: textCfg.model, provider: textCfg.provider
  });
  const content = await provider.complete(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildAiUserPrompt(item, type) }
    ],
    { temperature: 0.5, json: true }
  );
  const data = parseModelJson<Partial<AiEnrichPayload>>(content);
  return {
    meaningZh: (data.meaningZh || "").trim(),
    definitionEn: (data.definitionEn || "").trim(),
    example: (data.example || "").trim(),
    memoryHint: (data.memoryHint || "").trim(),
    imageSceneDescription: (data.imageSceneDescription || "").trim()
  };
}

// ---------- 组装单个词条 ----------
async function enrichOne(
  text: string,
  type: ContentItem["type"] | undefined,
  cfg: ResolvedAiCfg,
  useAi: boolean,
  useOnlineDict: boolean
): Promise<EnrichResult> {
  const errors: EnrichError[] = [];
  const itemType = type || detectContentType(text);
  const item: ContentItem = {
    id: uid("item"),
    packId: "",
    sort: 0,
    type: itemType,
    text,
    phonetic: "",
    partOfSpeech: "",
    meaningZh: "",
    definitionEn: "",
    example: "",
    audio: { source: "none", status: "none" },
    image: newImagePlaceholder(),
    aiMeta: { generatedBy: "none", generatedAt: Date.now() },
    fieldState: { ...EMPTY_FIELD_STATE },
    verified: false,
    locked: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const source: EnrichResult["source"] = {
    phonetic: "none",
    meaningZh: "none",
    definitionEn: "none",
    example: "none",
    image: "none"
  };

  // 1. 词典
  let dict: DictEntry | null = null;
  try {
    dict = useOnlineDict
      ? await dictionaryService.lookup(text)
      : await dictionaryService.lookupOffline(text);
  } catch (e) {
    errors.push({ stage: "dictionary", message: (e as Error).message });
  }
  if (dict) {
    if (dict.phonetic) {
      item.phonetic = dict.phonetic;
      source.phonetic = dict.source === "builtin" ? "builtin" : "dict-api";
    }
    if (dict.partOfSpeech) item.partOfSpeech = dict.partOfSpeech;
    if (dict.definitions.length) {
      item.definitionEn = dict.definitions[0].definition;
      source.definitionEn = "dict-api";
      if (!item.example && dict.definitions[0].example) {
        item.example = dict.definitions[0].example;
        source.example = "dict-api";
      }
    }
    if (dict.audio) {
      item.audio = { url: dict.audio, source: "dict", status: "ok" };
    }
  }

  // 2. AI 教学化（可选）
  let aiSceneDesc = "";
  if (useAi && cfg.text.enabled) {
    try {
      const ai = await enrichWithAi(cfg.text, text, itemType);
      if (ai.meaningZh) { item.meaningZh = ai.meaningZh; source.meaningZh = "ai"; }
      if (ai.definitionEn && !item.definitionEn) { item.definitionEn = ai.definitionEn; source.definitionEn = "ai"; }
      if (ai.example && !item.example) { item.example = ai.example; source.example = "ai"; }
      if (ai.memoryHint) item.aiMeta.memoryHint = ai.memoryHint;
      // 使用新的 imageSceneDescription（纯场景描述，不含词汇原文）
      if (ai.imageSceneDescription) {
        aiSceneDesc = ai.imageSceneDescription;
        item.aiMeta.imageDescription = aiSceneDesc;
      }
      item.aiMeta.generatedBy = "ai";
      item.aiMeta.generatedAt = Date.now();
    } catch (e) {
      errors.push({ stage: "text-ai", message: (e as Error).message });
    }
  }

  // 3. 图片策略（V4.1: AI 优先，builtin 降级为 legacy_builtin 离线兜底）
  try {
    const hasAiImage = cfg.image.enabled;
    const useApi = useOnlineDict; // 有网络时优先 API 搜索

    // 3a. API 图片搜索（Wikimedia）
    let apiImage: Awaited<ReturnType<typeof cacheApiImage>> | null = null;
    if (useApi) {
      try {
        const found = await searchImageApi(text.replace(/\s+/g, " "), 4);
        if (found.length) {
          apiImage = await cacheApiImage(found[0].thumbUrl, found[0].pageUrl, text);
          source.image = "api";
        }
      } catch { /* 忽略 API 搜索失败 */ }
    }

    if (apiImage) {
      item.image = { ...apiImage, status: "ok", locked: false, history: [] };
    } else if (hasAiImage) {
      // 3b. AI 图片生成（统一走 SceneGenerator + buildImagePrompt）
      // 优先使用 AI 文本服务生成的 scene description
      const sceneDesc = aiSceneDesc || generateVisualScene(text, item.meaningZh, itemType).sceneDescription;
      const prompt = buildImagePrompt({
        word: text,
        type: itemType,
        meaningZh: item.meaningZh || undefined,
        sceneDescription: sceneDesc,
        customInstruction: aiSceneDesc ? undefined : undefined
      });
      const gen = await generateImage(new OpenAiCompatibleImage({
        baseUrl: cfg.image.baseUrl, apiKey: cfg.image.apiKey, model: cfg.image.model, provider: cfg.image.provider
      }), prompt);
      item.image = { ...gen, status: "ok", locked: false, history: [] };
      source.image = "ai";
    } else {
      // 3c. 离线兜底：legacy_builtin（不再自动用 builtin，仅在无网络且无 AI 时使用）
      const builtin = findBuiltinImage(text);
      if (builtin) {
        item.image.localPath = builtinUrl(builtin.filename);
        item.image.sourceType = "legacy_builtin";
        item.image.status = "ok";
        source.image = "legacy_builtin";
      } else {
        source.image = "none";
      }
    }
  } catch (e) {
    errors.push({ stage: "image", message: (e as Error).message });
    // 图片生成失败不影响核心保存
  }

  return { item, errors, source };
}

// ---------- 对外入口 ----------
export async function enrichItems(db: Db, items: EnrichRequestItem[], opts: EnrichOpts = {}): Promise<EnrichResult[]> {
  const cfg = await collectResolvedCfg(db);
  const useAi = !opts.offlineOnly && cfg.text.enabled;
  const useOnlineDict = !opts.offlineOnly;

  const total = items.length;
  let done = 0;
  const results: EnrichResult[] = new Array(total);
  const concurrency = Math.min(opts.concurrency || DEFAULT_CONCURRENCY, total || 1);

  const worker = async (idx: number) => {
    const it = items[idx];
    try {
      const r = await enrichOne(it.text, it.type, cfg, useAi, useOnlineDict);
      r.item.packId = ""; // 由渲染端保存时填入
      results[idx] = r;
    } catch (e) {
      // 最外层兜底：构造一条仅含文本的空结果
      const item: ContentItem = {
        id: uid("item"), packId: "", sort: idx, type: it.type || detectContentType(it.text),
        text: it.text, phonetic: "", partOfSpeech: "", meaningZh: "", definitionEn: "", example: "",
        audio: { source: "none", status: "none" },
        image: newImagePlaceholder(),
        aiMeta: { generatedBy: "none", generatedAt: Date.now() },
        fieldState: { ...EMPTY_FIELD_STATE },
        verified: false, locked: false, createdAt: Date.now(), updatedAt: Date.now()
      };
      results[idx] = {
        item,
        errors: [{ stage: "dictionary", message: (e as Error).message }],
        source: { phonetic: "none", meaningZh: "none", definitionEn: "none", example: "none", image: "none" }
      };
    } finally {
      done++;
      opts.onProgress?.(done, total, it.text);
    }
  };

  // 简单并发池
  let next = 0;
  const runWorker = async () => {
    while (next < total) {
      const i = next++;
      await worker(i);
    }
  };
  const pool = Array.from({ length: concurrency }, runWorker);
  await Promise.all(pool);

  return results;
}

/** 单个字段的 AI 重新生成（按字段细分） */
export async function regenerateField(
  db: Db,
  item: ContentItem,
  field: "meaningZh" | "example" | "definitionEn" | "memoryHint" | "image"
): Promise<Partial<ContentItem>> {
  const cfg = await collectResolvedCfg(db);
  if (!cfg.text.enabled) throw new AiError("ai_not_configured", "AI 文本服务未配置");

  if (field === "image") {
    // 优先使用已有 scene description；若无则从词条文本重新生成
    const sceneDesc = item.aiMeta.imageDescription
      || generateVisualScene(item.text, item.meaningZh, item.type).sceneDescription;
    if (!sceneDesc) throw new AiError("ai_empty", "缺少图片场景描述，无法生成图片");
    if (!cfg.image.enabled) throw new AiError("ai_not_configured", "AI 图片服务未配置");
    const prompt = buildImagePrompt({
      word: item.text,
      type: item.type,
      meaningZh: item.meaningZh || undefined,
      sceneDescription: sceneDesc
    });
    const gen = await generateImage(new OpenAiCompatibleImage({
      baseUrl: cfg.image.baseUrl, apiKey: cfg.image.apiKey, model: cfg.image.model, provider: cfg.image.provider
    }), prompt);
    return {
      image: { ...gen, status: "ok", locked: item.image.locked, history: [] }
    };
  }

  // 文本字段重新生成（保持原有逻辑）
  const ai = await enrichWithAi(cfg.text, item.text, item.type);
  const patch: Partial<ContentItem> = {};
  if (field === "meaningZh") patch.meaningZh = ai.meaningZh;
  else if (field === "definitionEn") patch.definitionEn = ai.definitionEn;
  else if (field === "example") patch.example = ai.example;
  else if (field === "memoryHint") patch.aiMeta = { ...item.aiMeta, memoryHint: ai.memoryHint };
  return patch;
}

/** 创建空的图片占位符（sourceType 默认 "api" 而非 "builtin"） */
export function newImagePlaceholder(): ContentItem["image"] {
  return {
    localPath: "",
    sourceType: "api",
    sourceUrl: "",
    description: "",
    status: "ok",
    locked: false,
    history: []
  };
}

export { httpGet };
