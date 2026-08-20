// 题目队列工具：洗牌、去连续重复、随机抽题、干扰项生成。
// V4.2 重构：
//   1. 干扰项不足时从词包外的通用词补充（静态核心词库）
//   2. buildChoiceQuestion 增加 questionText 字段（教学化题干）
import type { ContentItem } from "../types";

// 静态核心词库（来自初中高频词，用于补充干扰项）
const CORE_DISTRACTORS: Record<string, string[]> = {
  word: ["decide", "carry", "improve", "protect", "support", "explain", "remember", "develop", "compare", "consider"],
  phrase: ["look after", "give up", "take off", "put on", "turn on", "turn off", "wake up", "get up", "clean up", "find out"],
  phrasal_verb: ["look after", "give up", "take off", "put on", "turn on", "turn off", "wake up", "get up", "clean up", "find out"],
  sentence: [],
  expression: []
};

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 生成题目顺序：打乱 + 消除相邻重复。
 * 当题库 >= 3 且重复超过阈值时重新洗牌重试。
 */
export function buildQueue(items: ContentItem[], maxRetry = 12): ContentItem[] {
  if (items.length <= 2) return shuffle(items);
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    const q = shuffle(items);
    let dup = 0;
    for (let i = 1; i < q.length; i++) {
      if (q[i].id === q[i - 1].id) dup++;
    }
    // 允许重复出现的题目是复习需求，这里只避免紧邻重复
    if (dup === 0 || attempt === maxRetry - 1) return q;
  }
  return shuffle(items);
}

/**
 * 单选干扰项：从词库取 N 个不同文本。
 * V4.2: 不足时用静态核心词库补充，确保至少 3 个选项。
 */
export function pickDistractors(
  items: ContentItem[],
  target: ContentItem,
  count: number
): ContentItem[] {
  const pool = items.filter((i) => i.id !== target.id && i.text.toLowerCase() !== target.text.toLowerCase());
  const shuffled = shuffle(pool);
  const result: ContentItem[] = shuffled.slice(0, count);

  // V4.2: 不足时用核心词库补充
  if (result.length < count) {
    const coreWords = CORE_DISTRACTORS[target.type] || CORE_DISTRACTORS["word"];
    const existingTexts = new Set(result.map((r) => r.text.toLowerCase()));
    for (const cw of coreWords) {
      if (result.length >= count) break;
      if (!existingTexts.has(cw.toLowerCase()) && cw.toLowerCase() !== target.text.toLowerCase()) {
        result.push({
          id: `core_${cw}`,
          packId: "",
          sort: 0,
          type: target.type,
          text: cw,
          phonetic: "",
          partOfSpeech: "",
          meaningZh: cw,
          definitionEn: "",
          example: "",
          audio: { source: "none", status: "none" },
          image: { localPath: "", sourceType: "api", sourceUrl: "", description: "", status: "ok", locked: false, history: [] },
          aiMeta: { generatedBy: "none", generatedAt: 0 },
          fieldState: { phonetic: "auto", meaningZh: "auto", definitionEn: "auto", example: "auto", image: "auto", audio: "auto" },
          verified: false,
          locked: false,
          createdAt: 0,
          updatedAt: 0
        } as ContentItem);
        existingTexts.add(cw.toLowerCase());
      }
    }
  }

  return result;
}

export interface ChoiceQuestion {
  prompt: string;
  promptKind: "text" | "meaning" | "image" | "audio" | "example";
  /** 教学化题干，供渲染端展示 */
  questionText: string;
  options: string[];
  answerIndex: number;
  answerItem: ContentItem;
}

/**
 * 选择挑战 / 英译中 / 中译英 的选项构造。
 * mode 决定 prompt 与选项方向。
 * V4.2: 增加 questionText（教学化题干），保证选项不少于3个。
 */
export function buildChoiceQuestion(
  items: ContentItem[],
  target: ContentItem,
  mode: "en2zh" | "zh2en" | "choice"
): ChoiceQuestion {
  const distractors = pickDistractors(items, target, 3);
  const pool = [target, ...distractors];
  const opts = shuffle(pool);
  const answerIndex = opts.findIndex((o) => o.id === target.id);

  if (mode === "en2zh") {
    return {
      prompt: target.text,
      promptKind: "text",
      questionText: `「${target.text}」是什么意思？`,
      options: opts.map((o) => o.meaningZh || o.text),
      answerIndex,
      answerItem: target
    };
  }
  if (mode === "zh2en") {
    return {
      prompt: target.meaningZh || target.text,
      promptKind: "meaning",
      questionText: `「${target.meaningZh || target.text}」对应的英文是？`,
      options: opts.map((o) => o.text),
      answerIndex,
      answerItem: target
    };
  }
  // choice：混合方向（随机选一个维度出题）
  const dims: Array<"text" | "meaning" | "example"> = ["text", "meaning"];
  if (target.example) dims.push("example");
  const dim = dims[Math.floor(Math.random() * dims.length)];
  if (dim === "meaning") {
    return {
      prompt: target.meaningZh || target.text,
      promptKind: "meaning",
      questionText: `「${target.meaningZh || target.text}」对应的英文是？`,
      options: opts.map((o) => o.text),
      answerIndex,
      answerItem: target
    };
  }
  if (dim === "example") {
    return {
      prompt: target.example,
      promptKind: "example",
      questionText: `哪一个词可以填入下面的句子？`,
      options: opts.map((o) => o.text),
      answerIndex,
      answerItem: target
    };
  }
  return {
    prompt: target.text,
    promptKind: "text",
    questionText: `「${target.text}」是什么意思？`,
    options: opts.map((o) => o.meaningZh || o.text),
    answerIndex,
    answerItem: target
  };
}

/** 情境猜词：用例句挖空 */
export function buildContextPrompt(item: ContentItem): { prompt: string; hint: string } {
  const ex = item.example || "";
  const word = item.text;
  if (ex) {
    const target = word.split(/\s+/)[0];
    const re = new RegExp(`\\b${escapeRegExp(target)}\\b`, "i");
    if (re.test(ex)) {
      const blank = ex.replace(re, (m) => m.replace(/[a-zA-Z]/g, "_"));
      return { prompt: blank, hint: word };
    }
    // 例句没有目标词：返回短描述 + 首字母提示
    const first = word.split(/\s+/)[0];
    return { prompt: ex, hint: `${first[0]}…` };
  }
  const first = word.split(/\s+/)[0];
  return { prompt: "", hint: `${first[0]}…` };
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
