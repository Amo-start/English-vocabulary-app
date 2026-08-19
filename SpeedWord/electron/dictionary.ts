// 词典层：
//   1. 内置 IPA-dict（en_US / en_UK）—— 离线基础音标
//   2. Free Dictionary API —— 联网补充词性/释义/例句/发音音频
//   3. AI —— 教学化中文解释（不作为音标唯一权威来源）
// Provider 化，便于未来接入 Oxford / Cambridge / 自定义词典 API。
import fs from "node:fs";
import path from "node:path";
import { dictionaryDir, httpGet } from "./util";
import { lookupIpa, parseIpaText, headWordOf, type IpaDictData } from "../src/shared/ipa";
import { AiError } from "./ai";

// ---------- 内置 IPA ----------
let ipaCache: IpaDictData | null = null;

export function loadIpaDict(): IpaDictData {
  if (ipaCache) return ipaCache;
  const data: IpaDictData = { enUs: new Map(), enUk: new Map(), count: 0 };
  try {
    const usPath = path.join(dictionaryDir("en_US.txt"));
    const ukPath = path.join(dictionaryDir("en_UK.txt"));
    if (fs.existsSync(usPath)) {
      const us = parseIpaText(fs.readFileSync(usPath, "utf8"));
      data.enUs = us;
      data.count += us.size;
    }
    if (fs.existsSync(ukPath)) {
      const uk = parseIpaText(fs.readFileSync(ukPath, "utf8"));
      data.enUk = uk;
      data.count += uk.size;
    }
  } catch (e) {
    console.error("ipa-dict load failed", e);
  }
  ipaCache = data;
  return data;
}

export interface DictEntry {
  word: string;
  phonetic?: string;
  phonetics: Array<{ text?: string; audio?: string }>;
  partOfSpeech?: string;
  definitions: Array<{ definition: string; example?: string; partOfSpeech?: string }>;
  meanings: Array<{ partOfSpeech: string; definitions: Array<{ definition: string; example?: string }> }>;
  audio?: string;
  source: "builtin" | "dict-api" | "ai" | "none";
}

export interface DictionaryProvider {
  name: string;
  lookup(word: string): Promise<DictEntry | null>;
}

// ---------- 内置音标 Provider ----------
export class BuiltinIpaProvider implements DictionaryProvider {
  name = "builtin-ipa";
  private data: IpaDictData;

  constructor() {
    this.data = loadIpaDict();
  }

  async lookup(word: string): Promise<DictEntry | null> {
    const res = lookupIpa(this.data, headWordOf(word) || word);
    if (!res.found) return null;
    return {
      word,
      phonetic: res.us || res.uk,
      phonetics: [{ text: res.us }, { text: res.uk }],
      definitions: [],
      meanings: [],
      source: "builtin"
    };
  }
}

// ---------- Free Dictionary API Provider ----------
interface FreeDictRaw {
  word: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example?: string }>;
  }>;
  sourceUrls?: string[];
}

export class FreeDictionaryProvider implements DictionaryProvider {
  name = "free-dictionary-api";
  private cache = new Map<string, DictEntry | null>();

  async lookup(word: string): Promise<DictEntry | null> {
    const key = word.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key) || null;
    // 词组/句子取核心词查询
    const head = headWordOf(word) || word;
    try {
      const buf = await httpGet(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(head)}`, 12000);
      const raw = JSON.parse(buf.toString("utf8")) as FreeDictRaw[];
      if (!Array.isArray(raw) || !raw[0]) {
        this.cache.set(key, null);
        return null;
      }
      const first = raw[0];
      const audioUrl = (first.phonetics || []).find((p) => p.audio)?.audio;
      const entry: DictEntry = {
        word: first.word || word,
        phonetic: first.phonetic,
        phonetics: (first.phonetics || []).filter((p) => p.text || p.audio),
        partOfSpeech: first.meanings?.[0]?.partOfSpeech,
        definitions: (first.meanings || []).flatMap((m) =>
          (m.definitions || []).map((d) => ({ definition: d.definition, example: d.example, partOfSpeech: m.partOfSpeech }))
        ),
        meanings: (first.meanings || []).map((m) => ({
          partOfSpeech: m.partOfSpeech,
          definitions: (m.definitions || []).map((d) => ({ definition: d.definition, example: d.example }))
        })),
        audio: audioUrl,
        source: "dict-api"
      };
      this.cache.set(key, entry);
      return entry;
    } catch (e) {
      if (e instanceof AiError) throw e;
      const err = e as Error & { status?: number };
      // 404 / 查不到 → 返回 null（不是致命错误）
      if (/HTTP 40[14]/.test(err.message || "")) {
        this.cache.set(key, null);
        return null;
      }
      this.cache.set(key, null);
      return null;
    }
  }
}

// ---------- 组合查询：内置 → 在线 → AI 建议 ----------
export class DictionaryService {
  providers: DictionaryProvider[];

  constructor() {
    this.providers = [new BuiltinIpaProvider(), new FreeDictionaryProvider()];
  }

  /** 离线可用查询（内置音标兜底） */
  async lookupOffline(text: string): Promise<DictEntry | null> {
    return new BuiltinIpaProvider().lookup(text);
  }

  /** 全量查询：内置 + 在线合并 */
  async lookup(text: string): Promise<DictEntry | null> {
    let merged: DictEntry | null = null;
    for (const p of this.providers) {
      try {
        const entry = await p.lookup(text);
        if (!entry) continue;
        if (!merged) {
          merged = entry;
          continue;
        }
        // 合并：优先在线数据
        if (entry.source === "dict-api") {
          merged = {
            ...entry,
            phonetic: entry.phonetic || merged.phonetic
          };
        } else if (!merged.phonetic) {
          merged.phonetic = entry.phonetic;
        }
      } catch (e) {
        console.warn(`dictionary provider ${p.name} failed`, e);
      }
    }
    return merged;
  }
}

export const dictionaryService = new DictionaryService();
