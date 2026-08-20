// 游戏题目统一结构 + 各玩法题目生成。
// V4.2 修复：
//   1. 选项题增加 questionText（教学化题干），与 prompt 分离
//   2. 答案渲染仅在 ANSWER_VISIBLE 之后显示（DOM 不提前存在）
//   3. 情境猜词增加 "请根据场景猜词" 提示语
import type { ContentItem, GameMode } from "../types";
import { buildChoiceQuestion, buildContextPrompt, pickDistractors } from "./queue";

export type QuestionKind =
  | "recall-text"     // 快速识词：显示词/短语 → 揭示
  | "picture"         // 看图猜词：图片 → 揭示
  | "choice"          // 选择挑战：问题 + 4 选项
  | "context"         // 情境猜词：场景 → 揭示
  | "flash";          // 翻牌

export interface ClassroomQuestion {
  kind: QuestionKind;
  mode: GameMode;
  item: ContentItem;
  /** 主线索文本（英文原文或中文释义） */
  promptText: string;
  /** 教学化题干（选择题专用，用于显示问题） */
  questionText?: string;
  /** 图片（本地路径或 sw:// url） */
  promptImage?: string;
  /** 选项题 */
  options?: string[];
  answerIndex?: number;
  /** 情境提示（首字母） */
  contextHint?: string;
  /** 展示辅助线索：是否默认显示音标 */
  showPhonetic: boolean;
}

function imageUrl(item: ContentItem): string | undefined {
  const p = item.image?.localPath;
  if (!p) return undefined;
  return p.startsWith("sw://") || p.startsWith("data:") ? p : `sw://img/${p}`;
}

/** 按玩法生成一道题 */
export function buildQuestion(item: ContentItem, mode: GameMode, allItems: ContentItem[]): ClassroomQuestion {
  switch (mode) {
    case "quick-read":
      return {
        kind: "recall-text",
        mode,
        item,
        promptText: item.text,
        showPhonetic: false
      };
    case "picture-guess": {
      const img = imageUrl(item);
      return {
        kind: "picture",
        mode,
        item,
        promptText: img ? "" : item.text,
        promptImage: img,
        showPhonetic: false
      };
    }
    case "choice":
    case "en2zh":
    case "zh2en": {
      const q = buildChoiceQuestion(allItems, item, mode === "choice" ? "choice" : mode);
      return {
        kind: "choice",
        mode,
        item,
        promptText: q.prompt,
        questionText: q.questionText,
        options: q.options,
        answerIndex: q.answerIndex,
        showPhonetic: false
      };
    }
    case "context": {
      const { prompt, hint } = buildContextPrompt(item);
      return {
        kind: "context",
        mode,
        item,
        promptText: prompt || "请根据场景猜词",
        contextHint: hint,
        showPhonetic: false
      };
    }
    case "random": {
      // 混合随机：随机选一个维度出题
      const sub = ["text", "meaning", "image", "example"][Math.floor(Math.random() * 4)] as
        | "text" | "meaning" | "image" | "example";
      if (sub === "image" && imageUrl(item)) {
        return {
          kind: "picture",
          mode,
          item,
          promptText: "",
          promptImage: imageUrl(item),
          showPhonetic: false
        };
      }
      if (sub === "meaning" && item.meaningZh) {
        return { kind: "recall-text", mode, item, promptText: item.meaningZh, showPhonetic: false };
      }
      if (sub === "example" && item.example) {
        return { kind: "context", mode, item, promptText: item.example, contextHint: item.text.split(/\s+/)[0][0] + "…", showPhonetic: false };
      }
      return { kind: "recall-text", mode, item, promptText: item.text, showPhonetic: false };
    }
    case "flash-recall":
      return {
        kind: "flash",
        mode,
        item,
        promptText: item.text,
        promptImage: imageUrl(item),
        showPhonetic: true
      };
    default:
      return {
        kind: "recall-text",
        mode,
        item,
        promptText: item.text,
        showPhonetic: false
      };
  }
}

/** 随机挑战的混合包：把整包转成题目 */
export function buildQuestionSequence(
  items: ContentItem[],
  mode: GameMode
): ClassroomQuestion[] {
  // 纯模式：直接顺序出题；random 模式：每个词条随机一个维度
  if (mode === "random") {
    return items.map((it) => buildQuestion(it, "random", items));
  }
  return items.map((it) => buildQuestion(it, mode, items));
}
