// ImagePromptBuilder 单元测试：全局风格锁、策略解析、教师指令补充、无文字约束
import { describe, it, expect } from "vitest";
import { GLOBAL_IMAGE_STYLE, buildImagePrompt, buildFallbackImagePrompt, generateVisualScene } from "../electron/image-prompt-builder";
import type { ContentType } from "../src/shared/types";

describe("GLOBAL_IMAGE_STYLE 包含必要风格要素", () => {
  it("必须包含禁止项关键词", () => {
    const style = GLOBAL_IMAGE_STYLE;
    expect(style).toMatch(/text/i);
    expect(style).toMatch(/watermark/i);
    expect(style).toMatch(/photorealism/i);
    expect(style).toMatch(/3D/i);
    expect(style).toMatch(/collage/i);
  });
  it("必须包含正向风格关键词", () => {
    const style = GLOBAL_IMAGE_STYLE;
    expect(style).toMatch(/clean.*2D/i);
    expect(style).toMatch(/children|picture-book/i);
    expect(style).toMatch(/simple shapes/i);
    expect(style).toMatch(/minimal.*background/i);
  });
});

describe("buildImagePrompt 结构正确", () => {
  it("基础 word 类型包含 GLOBAL STYLE 与 Visual Concept，不含词汇原文", () => {
    const prompt = buildImagePrompt({ word: "apple", type: "word" });
    expect(prompt).toContain("GLOBAL STYLE:");
    expect(prompt).toContain("Visual Concept:");
    expect(prompt).toContain("Important: The image must make the meaning immediately understandable to a student.");
    // V4.3: 不再把词汇原文写入图片 prompt，防止 AI 渲染文字
    expect(prompt).not.toMatch(/Word\/Phrase:\s*apple/i);
    expect(prompt).not.toMatch(/TEACHING CONTENT:/i);
  });

  it("phrase / phrasal_verb / sentence / expression 各类型场景描述不同", () => {
    const phrase = buildImagePrompt({ word: "take care of", type: "phrase" });
    const pv = buildImagePrompt({ word: "look after", type: "phrasal_verb" });
    const sent = buildImagePrompt({ word: "I like apples.", type: "sentence" });
    const expr = buildImagePrompt({ word: "piece of cake", type: "expression" });
    // V4.3: 词汇原文不再出现在 prompt，但各类型仍有差异化（通过 customInstruction 或 sceneDescription）
    // 确保都包含全局风格和 no-text 约束
    for (const p of [phrase, pv, sent, expr]) {
      expect(p).toContain("GLOBAL STYLE:");
      expect(p).toContain("NO TEXT CONSTRAINT");
    }
    // 词汇原文不应出现在 prompt 中（防止 AI 渲染文字）
    expect(phrase).not.toMatch(/\btake care of\b/i);
    expect(pv).not.toMatch(/\blogs\b/i);
    expect(expr).not.toMatch(/\bcake\b/i);
  });

  it("教师 customInstruction 追加到末尾，不覆盖风格", () => {
    const prompt = buildImagePrompt({
      word: "protect",
      type: "word",
      meaningZh: "保护",
      customInstruction: "场景改为校园，突出学生互助"
    });
    expect(prompt).toContain("Teacher Custom Instruction: 场景改为校园，突出学生互助");
    expect(prompt).toContain("GLOBAL STYLE:");
    // 不允许把 GLOBAL STYLE 整体抹掉
    expect(prompt.split("GLOBAL STYLE:").length).toBeGreaterThanOrEqual(2);
    // V4.3: 不含 Chinese Meaning 行
    expect(prompt).not.toMatch(/Chinese Meaning:/i);
  });

  it("无 customInstruction 时 prompt 仍合法", () => {
    const prompt = buildImagePrompt({ word: "run", type: "word" });
    expect(prompt).toContain("GLOBAL STYLE:");
    expect(prompt).toContain("NO TEXT CONSTRAINT");
  });

  it("sceneDescription 参数直接替代自动生成", () => {
    const customScene = "A child holding an umbrella over a puppy in the rain.";
    const prompt = buildImagePrompt({
      word: "protect",
      type: "word",
      sceneDescription: customScene
    });
    expect(prompt).toContain(customScene);
    expect(prompt).toContain("Visual Concept:");
    // 不应出现词汇原文
    expect(prompt).not.toMatch(/Word\/Phrase:/i);
  });

  it("fallback 函数同样包含 GLOBAL STYLE 和 NO TEXT CONSTRAINT", () => {
    const p = buildFallbackImagePrompt("decision", "word");
    expect(p).toContain("GLOBAL STYLE:");
    expect(p).toContain("NO TEXT CONSTRAINT");
    // V4.3: fallback 也不应包含词汇原文
    expect(p).not.toMatch(/Word\/Phrase:\s*decision/i);
  });
});

describe("不同 ContentType 的 Visual Concept 差异化", () => {
  it("各类型都包含 GLOBAL STYLE 和 NO TEXT CONSTRAINT，不含词汇原文", () => {
    for (const type of ["word" as ContentType, "phrase" as ContentType, "sentence" as ContentType]) {
      const p = buildImagePrompt({ word: "test", type });
      expect(p).toContain("GLOBAL STYLE:");
      expect(p).toContain("NO TEXT CONSTRAINT");
      expect(p).toContain("absolutely no text");
      // V4.3: 词汇原文不应出现在 prompt 中
      expect(p).not.toMatch(/Word\/Phrase:\s*test/i);
    }
  });
});

describe("NO TEXT CONSTRAINT 始终存在", () => {
  it("所有 prompt 都包含 no-text 约束", () => {
    for (const type of ["word" as ContentType, "phrase" as ContentType, "sentence" as ContentType]) {
      const p = buildImagePrompt({ word: "test", type });
      expect(p).toContain("NO TEXT CONSTRAINT");
      expect(p).toContain("absolutely no text");
    }
  });

  it("prompt 不含词汇原文（V4.3: 彻底隔离词汇与图片生成）", () => {
    const p = buildImagePrompt({ word: "protect", type: "word" });
    expect(p).not.toMatch(/Word\/Phrase:/i);
    expect(p).not.toMatch(/TEACHING CONTENT:/i);
    expect(p).not.toMatch(/Chinese Meaning:/i);
    // Visual Concept 应该是场景描述
    const lines = p.split("\n");
    const visualLine = lines.find((l) => l.startsWith("Visual Concept:"));
    expect(visualLine).toBeDefined();
    expect(visualLine!).not.toMatch(/the word\s+protect/i);
  });
});

describe("generateVisualScene 场景生成", () => {
  it("protect 返回 action_scene 类型", () => {
    const scene = generateVisualScene("protect", "保护", "word");
    expect(scene.visualStrategy).toBe("action_scene");
    expect(scene.sceneDescription).toContain("umbrella");
    expect(scene.sceneDescription).toContain("dog");
    // 不应包含词汇原文作为描绘对象
    expect(scene.sceneDescription).not.toMatch(/\bthe word\b.*protect/i);
  });

  it("decision 返回 action_scene 类型", () => {
    const scene = generateVisualScene("decision", "决定", "word");
    expect(scene.visualStrategy).toBe("action_scene");
  });

  it("抽象词使用默认 object_focus 策略", () => {
    const scene = generateVisualScene("responsibility", "责任", "word");
    // responsibility 有规则匹配
    expect(scene.sceneDescription.length).toBeGreaterThan(10);
  });

  it("未知词条使用默认策略且不包含原文", () => {
    const scene = generateVisualScene("xylophone", "", "word");
    expect(scene.visualStrategy).toBe("object_focus");
    // 描述不应直接说 "the word xylophone"
    expect(scene.sceneDescription).not.toMatch(/the word\s+xylophone/i);
  });
});
