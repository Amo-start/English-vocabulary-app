// 题目队列工具：洗牌、去连续重复、随机抽题。
import type { ContentItem } from "../types";

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

/** 单选干扰项：从词库取 N 个不同文本 */
export function pickDistractors(
  items: ContentItem[],
  target: ContentItem,
  count: number
): ContentItem[] {
  const pool = items.filter((i) => i.id !== target.id && i.text.toLowerCase() !== target.text.toLowerCase());
  const shuffled = shuffle(pool);
  return shuffled.slice(0, count);
}

export interface ChoiceQuestion {
  prompt: string;
  promptKind: "text" | "meaning" | "image" | "audio" | "example";
  options: string[];
  answerIndex: number;
  answerItem: ContentItem;
}

/**
 * 选择挑战 / 英译中 / 中译英 的选项构造。
 * mode 决定 prompt 与选项方向。
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
      options: opts.map((o) => o.meaningZh || o.text),
      answerIndex,
      answerItem: target
    };
  }
  if (mode === "zh2en") {
    return {
      prompt: target.meaningZh || target.text,
      promptKind: "meaning",
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
      options: opts.map((o) => o.text),
      answerIndex,
      answerItem: target
    };
  }
  if (dim === "example") {
    return {
      prompt: target.example,
      promptKind: "example",
      options: opts.map((o) => o.text),
      answerIndex,
      answerItem: target
    };
  }
  return {
    prompt: target.text,
    promptKind: "text",
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
