import { describe, it, expect } from "vitest";
import { parseIpaText, lookupIpa, wordForms, headWordOf, normalizeForIpa } from "../src/shared/ipa";
import type { IpaDictData } from "../src/shared/ipa";

// 构造少量词典数据（word\t/IPA/）
const DATA: IpaDictData = {
  enUs: parseIpaText(`apple\t/ˈæp.əl/\nbanana\t/bəˈnæn.ə/\nlook\t/lʊk/\nstop\t/stɒp/\nrunning\t/ˈrʌn.ɪŋ/`),
  enUk: parseIpaText(`apple\t/ˈæp.əl/\nbanana\t/bəˈnɑː.nə/`),
  count: 5
};

describe("parseIpaText", () => {
  it("解析 word\\t/IPA/ 行，去掉斜杠", () => {
    const m = parseIpaText("apple\t/ˈæp.əl/\nbanana\t/bəˈnæn.ə/");
    expect(m.get("apple")).toBe("ˈæp.əl");
    expect(m.get("banana")).toBe("bəˈnæn.ə");
  });

  it("忽略格式错误的行", () => {
    const m = parseIpaText("apple\n\t\n/foo/\nok\t/ˈoʊk/");
    expect(m.get("ok")).toBe("ˈoʊk");
    expect(m.size).toBe(1);
  });
});

describe("lookupIpa", () => {
  it("精确命中", () => {
    const r = lookupIpa(DATA, "apple");
    expect(r.found).toBe(true);
    expect(r.us).toBe("ˈæp.əl");
  });

  it("词形还原：running → run", () => {
    const r = lookupIpa(DATA, "running");
    expect(r.found).toBe(true);
    expect(r.us).toBe("ˈrʌn.ɪŋ");
  });

  it("复数还原 apples → apple", () => {
    const r = lookupIpa(DATA, "apples");
    expect(r.found).toBe(true);
    expect(r.us).toBe("ˈæp.əl");
  });

  it("未命中返回 found=false（data 为 null 不抛错）", () => {
    expect(lookupIpa(null, "xyz")).toEqual({ found: false });
    expect(lookupIpa(DATA, "zzzzzz").found).toBe(false);
  });
});

describe("wordForms", () => {
  it("包含原形与常见词形", () => {
    const forms = wordForms("stopped");
    expect(forms).toContain("stopped");
    expect(forms).toContain("stop");
  });
});

describe("headWordOf", () => {
  it("跳过冠词/介词取实义词", () => {
    expect(headWordOf("take care of the baby")).toBe("take");
    expect(headWordOf("an apple")).toBe("apple");
  });
});

describe("normalizeForIpa", () => {
  it("小写并去掉标点", () => {
    expect(normalizeForIpa("  Apple! ")).toBe("apple");
  });
});
