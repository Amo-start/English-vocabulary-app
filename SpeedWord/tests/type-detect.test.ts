import { describe, it, expect } from "vitest";
import { detectContentType, parseInputText, typeLabel, typeEmoji } from "../src/shared/type-detect";

describe("内容类型自动识别", () => {
  it("单词", () => {
    expect(detectContentType("apple")).toBe("word");
    expect(detectContentType("responsibility")).toBe("word");
  });

  it("双词词组", () => {
    expect(detectContentType("green apple")).toBe("phrase");
    expect(detectContentType("good morning")).toBe("phrase");
  });

  it("短语动词（look after / take care of）", () => {
    expect(detectContentType("look after")).toBe("phrasal_verb");
    expect(detectContentType("take care of")).toBe("phrasal_verb");
  });

  it("习语表达", () => {
    expect(detectContentType("piece of cake")).toBe("expression");
    expect(detectContentType("break the ice")).toBe("expression");
  });

  it("句子", () => {
    expect(detectContentType("I have to take care of my little brother.")).toBe("sentence");
    expect(detectContentType("She is reading a book")).toBe("sentence");
  });

  it("空串兜底为 word", () => {
    expect(detectContentType("")).toBe("word");
  });
});

describe("parseInputText 多行解析", () => {
  it("每行一个词，去重、去空行、跳过注释", () => {
    const r = parseInputText(`apple
# 注释行
banana
apple

green apple`);
    expect(r.lines.length).toBe(3);
    expect(r.lines[0].text).toBe("apple");
    expect(r.lines[1].text).toBe("banana");
    expect(r.lines[2].text).toBe("green apple");
  });

  it("支持 单词|中文|例句 格式（保留第一部分）", () => {
    const r = parseInputText("apple|苹果|An apple a day.");
    expect(r.lines[0].text).toBe("apple");
  });

  it("跳过无英文字母的行", () => {
    const r = parseInputText("apple\n12345\nbanana");
    expect(r.lines.length).toBe(2);
    expect(r.skipped).toContain("12345");
  });
});

describe("类型中文标签", () => {
  it("标签非空且稳定", () => {
    for (const t of ["word", "phrase", "phrasal_verb", "sentence", "expression"] as const) {
      expect(typeLabel(t).length).toBeGreaterThan(0);
      expect(typeEmoji(t).length).toBeGreaterThan(0);
    }
  });
});
