import { describe, it, expect } from "vitest";
import { shuffle, buildQueue, pickDistractors, buildChoiceQuestion, buildContextPrompt, escapeRegExp } from "../src/shared/game/queue";
import type { ContentItem } from "../src/shared/types";

function item(id: string, text: string, meaningZh = ""): ContentItem {
  return {
    id, packId: "p", sort: 0, type: "word", text, phonetic: "", partOfSpeech: "",
    meaningZh, definitionEn: "", example: "", audio: { source: "none", status: "none" },
    image: { localPath: "", sourceType: "builtin", sourceUrl: "", description: "", status: "ok", locked: false, history: [] },
    aiMeta: { generatedBy: "none", generatedAt: 0 }, fieldState: { phonetic: "auto", meaningZh: "auto", definitionEn: "auto", example: "auto", image: "auto", audio: "auto" },
    verified: false, locked: false, createdAt: 0, updatedAt: 0
  };
}

const ITEMS = ["apple", "banana", "cat", "dog", "egg", "fish"].map((t, i) => item(`i${i}`, t, `${t}的中文`));

describe("shuffle", () => {
  it("保留全部元素", () => {
    const out = shuffle(ITEMS);
    expect(out).toHaveLength(ITEMS.length);
    expect(new Set(out.map((i) => i.id))).toEqual(new Set(ITEMS.map((i) => i.id)));
  });
});

describe("buildQueue 出题顺序", () => {
  it("题库 >= 3 时尽量消除相邻重复（启发式，不保证完全消除）", () => {
    const q = buildQueue([...ITEMS, ...ITEMS, ...ITEMS]);
    expect(q).toHaveLength(ITEMS.length * 3);
    // 全部词条都在（排列完整）
    expect(new Set(q.map((i) => i.id)).size).toBe(ITEMS.length);
    let dup = 0;
    for (let i = 1; i < q.length; i++) if (q[i].id === q[i - 1].id) dup++;
    // 相邻重复应远小于可能的重复上限（明显改善）
    expect(dup).toBeLessThanOrEqual(3);
  });

  it("1~2 个词条直接洗牌", () => {
    expect(buildQueue([ITEMS[0]])).toHaveLength(1);
    expect(buildQueue(ITEMS.slice(0, 2))).toHaveLength(2);
  });
});

describe("pickDistractors", () => {
  it("干扰项不含目标词", () => {
    const d = pickDistractors(ITEMS, ITEMS[0], 3);
    expect(d).toHaveLength(3);
    expect(d.every((x) => x.id !== ITEMS[0].id)).toBe(true);
  });

  it("不足干扰项时用核心词库补充，确保至少3个", () => {
    // 词包只有2个词：apple, banana
    const small = [ITEMS[0], ITEMS[1]];
    const d = pickDistractors(small, small[0], 3);
    // V4.2: 不足时用核心词库补充，确保 >= 3 个
    expect(d.length).toBeGreaterThanOrEqual(3);
    // 干扰项不含目标词
    expect(d.every((x) => x.id !== small[0].id)).toBe(true);
  });

  it("小词包（3词）也能产生4个选项", () => {
    const small = ITEMS.slice(0, 3);
    const d = pickDistractors(small, small[0], 3);
    expect(d.length).toBeGreaterThanOrEqual(3);
  });
});

describe("buildChoiceQuestion", () => {
  it("英译中：prompt 为英文，选项为中文，有教学化题干", () => {
    const q = buildChoiceQuestion(ITEMS, ITEMS[0], "en2zh");
    expect(q.prompt).toBe("apple");
    expect(q.options).toHaveLength(4);
    expect(q.answerIndex).toBeGreaterThanOrEqual(0);
    expect(q.options[q.answerIndex]).toBe(ITEMS[0].meaningZh);
    // V4.2: 有 questionText
    expect(q.questionText).toBeTruthy();
    expect(typeof q.questionText).toBe("string");
  });

  it("中译英：prompt 为中文，选项为英文", () => {
    const q = buildChoiceQuestion(ITEMS, ITEMS[0], "zh2en");
    expect(q.prompt).toBe("apple的中文");
    expect(q.options).toContain("apple");
    expect(q.options[q.answerIndex]).toBe("apple");
    expect(q.questionText).toBeTruthy();
  });

  it("答案索引指向目标词的文本或释义（方向随机）", () => {
    const q = buildChoiceQuestion(ITEMS, ITEMS[2], "choice");
    const answer = q.options[q.answerIndex];
    expect(answer === q.answerItem.text || answer === q.answerItem.meaningZh).toBe(true);
  });

  it("小词包（3词）仍可生成4个选项", () => {
    const small = ITEMS.slice(0, 3);
    const q = buildChoiceQuestion(small, small[0], "en2zh");
    expect(q.options.length).toBeGreaterThanOrEqual(4);
    expect(q.options[q.answerIndex]).toBe(small[0].meaningZh);
  });
});

describe("buildContextPrompt 情境挖空", () => {
  it("例句包含目标词时挖空", () => {
    const it = { ...item("i0", "apple"), example: "I eat an apple every day." };
    const { prompt, hint } = buildContextPrompt(it);
    expect(prompt).not.toContain("apple");
    expect(prompt).toContain("____");
    expect(hint).toBe("apple");
  });

  it("例句不含目标词时给出首字母提示", () => {
    const it = { ...item("i0", "apple"), example: "This is a red fruit." };
    const { hint } = buildContextPrompt(it);
    expect(hint).toMatch(/^a/);
  });

  it("无例句时也给出首字母提示", () => {
    const { hint } = buildContextPrompt(item("i0", "banana"));
    expect(hint).toMatch(/^b/);
  });
});

describe("escapeRegExp", () => {
  it("转义正则元字符", () => {
    expect(escapeRegExp("a.b+c(d)")).toBe("a\\.b\\+c\\(d\\)");
  });
});
