import { describe, it, expect } from "vitest";
import { mergeEnrichIntoItem } from "../src/services/enrichMerge";
import type { ContentItem } from "../src/shared/types";

function item(over: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "i1", packId: "p", sort: 0, type: "word", text: "apple", phonetic: "",
    partOfSpeech: "", meaningZh: "", definitionEn: "", example: "",
    audio: { source: "none", status: "none" },
    image: { localPath: "", sourceType: "builtin", sourceUrl: "", description: "", status: "ok", locked: false, history: [] },
    aiMeta: { generatedBy: "none", generatedAt: 0 },
    fieldState: { phonetic: "auto", meaningZh: "auto", definitionEn: "auto", example: "auto", image: "auto", audio: "auto" },
    verified: false, locked: false, createdAt: 0, updatedAt: 0,
    ...over
  };
}

function fresh(over: Partial<ContentItem> = {}): ContentItem {
  return item({
    phonetic: "/ˈæp.əl/", meaningZh: "苹果", definitionEn: "a round fruit",
    example: "An apple a day.", partOfSpeech: "n.",
    aiMeta: { generatedBy: "ai", generatedAt: 1, memoryHint: "apple 像 Apple 公司 logo", imageDescription: "red apple on table" },
    ...over
  });
}

describe("mergeEnrichIntoItem（验收点 #6：锁定/已改不覆盖）", () => {
  it("auto 字段全部回填", () => {
    const cur = item();
    const next = mergeEnrichIntoItem(cur, fresh());
    expect(next.phonetic).toBe("/ˈæp.əl/");
    expect(next.meaningZh).toBe("苹果");
    expect(next.example).toBe("An apple a day.");
    expect(next.partOfSpeech).toBe("n.");
  });

  it("教师已编辑的 meaningZh 不被覆盖", () => {
    const cur = item({ meaningZh: "我写的解释", fieldState: { ...item().fieldState, meaningZh: "edited" } });
    const next = mergeEnrichIntoItem(cur, fresh({ meaningZh: "AI 的解释" }));
    expect(next.meaningZh).toBe("我写的解释");
    expect(next.phonetic).toBe("/ˈæp.əl/"); // 其他字段正常
  });

  it("锁定的字段不被覆盖", () => {
    const cur = item({
      meaningZh: "锁定解释",
      fieldState: { ...item().fieldState, meaningZh: "locked", phonetic: "locked" }
    });
    const next = mergeEnrichIntoItem(cur, fresh({ phonetic: "/AI/" }));
    expect(next.meaningZh).toBe("锁定解释");
    expect(next.phonetic).toBe(""); // locked 且原本为空 → 保持为空
  });

  it("锁定的图片不被覆盖", () => {
    const cur = item({
      image: { ...item().image, localPath: "sw://img/my.png" },
      fieldState: { ...item().fieldState, image: "locked" }
    });
    const next = mergeEnrichIntoItem(cur, fresh({
      image: { localPath: "sw://img/ai.png", sourceType: "ai", sourceUrl: "", description: "", status: "ok", locked: false, history: [] }
    }));
    expect(next.image.localPath).toBe("sw://img/my.png");
  });

  it("整词锁定也保持（verified/locked 标志不丢）", () => {
    const cur = item({ locked: true, verified: true });
    const next = mergeEnrichIntoItem(cur, fresh());
    expect(next.locked).toBe(true);
    expect(next.verified).toBe(true);
  });

  it("memoryHint 补入", () => {
    const next = mergeEnrichIntoItem(item(), fresh());
    expect(next.aiMeta?.memoryHint).toBe("apple 像 Apple 公司 logo");
  });
});
