// 智能补全编排：词典 → AI 教学化 → 图片策略 → 组装 ContentItem
// 异常按词条隔离：单个词条失败不影响其他词条。
import { DictionaryService, dictionaryService, type DictEntry } from "./dictionary";
import {
  resolveAiCfg, OpenAiCompatibleText, OpenAiCompatibleImage, parseModelJson, AiError,
  type ResolvedAiCfg
} from "./ai";
import {
  findBuiltinImage, searchImageApi, generateImage, cacheApiImage, builtinUrl, newImagePlaceholder
} from "./images";
import { getSecret } from "./secure-store";
import type { Db } from "./db";
import { readAiConfig } from "./db";
import { detectContentType, typeLabel } from "../src/shared/type-detect";
import { uid } from "../src/shared/uuid";
import { EMPTY_FIELD_STATE } from "../src/shared/fieldstate";
import type { ContentItem, EnrichError, EnrichResult } from "../src/shared/types";
import { httpGet } from "./util";

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
  imageDescription: string;
}

const SYSTEM_PROMPT = `你是经验丰富的初中英语教师，负责把英文词条加工成适合中国学生课堂使用的教学素材。
规则：
1. meaningZh：简洁准确的中文解释（一词条一行，含适用语境）。
2. definitionEn：给初中生看的英文释义，用简单词。
3. example：一个自然、课堂可用的英文例句（配中文对照放 example 即可，格式 "英文. 中文。"）。
4. memoryHint：帮助学生记忆的提示（联想/词根/谐音，中文）。
5. imageDescription：适合生成"教学情境插画"的英文图片描述，要求主体明确、背景干净、画面无任何文字、适合教室大屏投影，60 词以内。
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
    imageDescription: (data.imageDescription || "").trim()
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
  if (useAi && cfg.text.enabled) {
    try {
      const ai = await enrichWithAi(cfg.text, text, itemType);
      if (ai.meaningZh) { item.meaningZh = ai.meaningZh; source.meaningZh = "ai"; }
      if (ai.definitionEn && !item.definitionEn) { item.definitionEn = ai.definitionEn; source.definitionEn = "ai"; }
      if (ai.example && !item.example) { item.example = ai.example; source.example = "ai"; }
      if (ai.memoryHint) item.aiMeta.memoryHint = ai.memoryHint;
      if (ai.imageDescription) item.aiMeta.imageDescription = ai.imageDescription;
      item.aiMeta.generatedBy = "ai";
      item.aiMeta.generatedAt = Date.now();
    } catch (e) {
      errors.push({ stage: "text-ai", message: (e as Error).message });
    }
  }

  // 3. 图片策略
  try {
    const hasAiImage = cfg.image.enabled;
    const builtin = findBuiltinImage(text);
    if (builtin) {
      item.image.localPath = builtinUrl(builtin.filename);
      item.image.sourceType = "builtin";
      item.image.status = "ok";
      source.image = "builtin";
    } else if (useOnlineDict || true) {
      // API 搜索（Wikimedia，免费）
      const found = await searchImageApi(text.replace(/\s+/g, " "), 4);
      if (found.length) {
        const cached = await cacheApiImage(found[0].thumbUrl, found[0].pageUrl, text);
        item.image = { ...cached, status: "ok", locked: false, history: [] };
        source.image = "api";
      } else if (hasAiImage) {
        // API 没搜到 → AI 生成
        const desc = item.aiMeta.imageDescription || `Simple clean illustration of "${text}" for classroom screen, no text`;
        const gen = await generateImage(new OpenAiCompatibleImage({
          baseUrl: cfg.image.baseUrl, apiKey: cfg.image.apiKey, model: cfg.image.model, provider: cfg.image.provider
        }), desc);
        item.image = { ...gen, status: "ok", locked: false, history: [] };
        source.image = "ai";
      }
    }
  } catch (e) {
    errors.push({ stage: "image", message: (e as Error).message });
  }

  return { item, errors, source };
}

// ---------- 对外入口 ----------
export async function enrichItems(db: Db, items: EnrichRequestItem[], opts: EnrichOpts = {}): Promise<EnrichResult[]> {
  const config = readAiConfig(db.db);
  const secrets = {
    main: getSecret(db, "main"),
    text: getSecret(db, "text"),
    image: getSecret(db, "image"),
    dictionary: getSecret(db, "dictionary")
  };
  const cfg = resolveAiCfg(config, secrets);
  const useAi = !opts.offlineOnly && config.mode !== "off";
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

  // results 已按输入顺序填满
  return results;
}

/** 单个字段的 AI 重新生成（按字段细分） */
export async function regenerateField(
  db: Db,
  item: ContentItem,
  field: "meaningZh" | "example" | "definitionEn" | "memoryHint" | "image"
): Promise<Partial<ContentItem>> {
  const config = readAiConfig(db.db);
  const secrets = { main: getSecret(db, "main"), text: getSecret(db, "text"), image: getSecret(db, "image"), dictionary: getSecret(db, "dictionary") };
  const cfg = resolveAiCfg(config, secrets);
  if (!cfg.text.enabled) throw new AiError("ai_not_configured", "AI 文本服务未配置");

  const ai = await enrichWithAi(cfg.text, item.text, item.type);
  const patch: Partial<ContentItem> = {};

  if (field === "image") {
    const desc = item.image.description || item.aiMeta.imageDescription || ai.imageDescription;
    if (!desc) throw new AiError("ai_empty", "缺少图片描述，无法生成图片");
    if (!cfg.image.enabled) throw new AiError("ai_not_configured", "AI 图片服务未配置");
    const gen = await generateImage(new OpenAiCompatibleImage({
      baseUrl: cfg.image.baseUrl, apiKey: cfg.image.apiKey, model: cfg.image.model, provider: cfg.image.provider
    }), desc);
    patch.image = { ...gen, status: "ok", locked: item.image.locked, history: [] };
    patch.aiMeta = { ...item.aiMeta, imageDescription: desc };
    return patch;
  }

  if (field === "meaningZh") patch.meaningZh = ai.meaningZh;
  else if (field === "definitionEn") patch.definitionEn = ai.definitionEn;
  else if (field === "example") patch.example = ai.example;
  else if (field === "memoryHint") patch.aiMeta = { ...item.aiMeta, memoryHint: ai.memoryHint };
  return patch;
}

export { httpGet };
