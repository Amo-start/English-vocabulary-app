import { describe, it, expect } from "vitest";
import { buildQuestion, buildQuestionSequence } from "../src/shared/game/question";
import type { ContentItem } from "../src/shared/types";

function item(id: string, text: string, opts: Partial<ContentItem> = {}): ContentItem {
  return {
    id, packId: "p", sort: 0, type: "word", text, phonetic: "/fəˈnɛtɪk/", partOfSpeech: "n.",
    meaningZh: `${text}的中文`, definitionEn: `def of ${text}`, example: `This is ${text}.`,
    audio: { source: "none", status: "none" },
    image: { localPath: "", sourceType: "builtin", sourceUrl: "", description: "", status: "ok", locked: false, history: [] },
    aiMeta: { generatedBy: "none", generatedAt: 0 },
    fieldState: { phonetic: "auto", meaningZh: "auto", definitionEn: "auto", example: "auto", image: "auto", audio: "auto" },
    verified: false, locked: false, createdAt: 0, updatedAt: 0,
    ...opts
  };
}

const ITEMS = [
  item("a", "apple", { image: { ...item("", "").image, localPath: "apple.png" } }),
  item("b", "banana"),
  item("c", "cat"),
  item("d", "dog")
];

describe("buildQuestion 各玩法出题", () => {
  it("快速识词：显示文本", () => {
    const q = buildQuestion(ITEMS[0], "quick-read", ITEMS);
    expect(q.kind).toBe("recall-text");
    expect(q.promptText).toBe("apple");
    expect(q.showPhonetic).toBe(false);
  });

  it("看图猜词：有图用图，无图退回文本", () => {
    const withImg = buildQuestion(ITEMS[0], "picture-guess", ITEMS);
    expect(withImg.kind).toBe("picture");
    expect(withImg.promptImage).toMatch(/^sw:\/\//);
    const noImg = buildQuestion(ITEMS[1], "picture-guess", ITEMS);
    expect(noImg.kind).toBe("picture");
    expect(noImg.promptImage).toBeUndefined();
    expect(noImg.promptText).toBe("banana");
  });

  it("选择挑战：4 个选项且答案索引合法，包含教学化题干", () => {
    const q = buildQuestion(ITEMS[0], "choice", ITEMS);
    expect(q.kind).toBe("choice");
    expect(q.options?.length).toBeGreaterThanOrEqual(3);
    expect(q.answerIndex).toBeGreaterThanOrEqual(0);
    expect(q.promptText).toBeTruthy();
    expect(q.options?.[q.answerIndex!]).toBeTruthy();
    // V4.2: 必须有 questionText（教学化题干）
    expect(q.questionText).toBeTruthy();
    expect(typeof q.questionText).toBe("string");
    expect(q.questionText!.length).toBeGreaterThan(3);
    // 选项应包含目标词的文本或释义之一（方向随机，两种都算对）
    const hasTargetText = q.options!.includes(ITEMS[0].text);
    const hasTargetMeaning = q.options!.includes(ITEMS[0].meaningZh);
    expect(hasTargetText || hasTargetMeaning).toBe(true);
    expect(q.options?.[q.answerIndex!]).not.toBeUndefined();
  });

  it("英译中：prompt 为英文，选项为中文，有题干", () => {
    const en = buildQuestion(ITEMS[0], "en2zh", ITEMS);
    expect(en.kind).toBe("choice");
    expect(en.promptText).toBe("apple");
    expect(en.questionText).toContain("apple");
    expect(en.options).toContain("apple的中文");
  });

  it("中译英：prompt 为中文，选项为英文，有题干", () => {
    const zh = buildQuestion(ITEMS[0], "zh2en", ITEMS);
    expect(zh.kind).toBe("choice");
    expect(zh.questionText).toContain("apple的中文");
    expect(zh.options).toContain("apple");
  });

  it("情境猜词：提示首字母", () => {
    const q = buildQuestion(ITEMS[0], "context", ITEMS);
    expect(q.kind).toBe("context");
    expect(q.contextHint).toBeTruthy();
  });

  it("翻牌：显示音标", () => {
    const q = buildQuestion(ITEMS[0], "flash-recall", ITEMS);
    expect(q.kind).toBe("flash");
    expect(q.showPhonetic).toBe(true);
  });

  it("随机挑战：kind 合法且模式保留", () => {
    const q = buildQuestion(ITEMS[0], "random", ITEMS);
    expect(["recall-text", "picture", "context"].includes(q.kind)).toBe(true);
    expect(q.mode).toBe("random");
  });
});

describe("buildQuestionSequence", () => {
  it("顺序生成整包题目，数量一致", () => {
    const seq = buildQuestionSequence(ITEMS, "quick-read");
    expect(seq).toHaveLength(ITEMS.length);
    expect(seq.every((q) => q.mode === "quick-read")).toBe(true);
  });

  it("random 模式逐个随机维度", () => {
    const seq = buildQuestionSequence(ITEMS, "random");
    expect(seq).toHaveLength(ITEMS.length);
    expect(seq.every((q) => q.mode === "random")).toBe(true);
  });
});
