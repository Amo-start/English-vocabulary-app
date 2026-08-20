// ImagePromptBuilder：全局视觉风格锁 + 语义场景生成 + 无文字约束
// V4.1 重构：AI 图片不得出现词汇原文，必须通过 SceneGenerator 先描述场景再绘图。
import type { ContentType } from "../src/shared/types";

// ---------------------------------------------------------------------------
// 全局风格锁
// ---------------------------------------------------------------------------
export const GLOBAL_IMAGE_STYLE = `GLOBAL STYLE:
Create a clean 2D educational children's picture-book illustration for English vocabulary learning.
Visual style:
- consistent classroom illustration style
- clean simple shapes
- soft gouache-like texture
- gentle warm colors
- clear silhouettes
- friendly child-friendly characters
- minimal clean background
- one clear main action
- high semantic clarity
- visually readable from a classroom projection
- suitable for elementary and middle school students
Composition:
- one primary subject or action
- centered composition
- simple visual hierarchy
- avoid unnecessary objects
- avoid visual clutter
STRICTLY AVOID:
- text
- letters
- words
- logos
- watermarks
- photorealism
- 3D rendering
- cinematic realism
- abstract concept art
- collage
- complicated background
- excessive detail
- horror
- violence
- inappropriate content`;

// ---------------------------------------------------------------------------
// 无文字绝对约束（追加到每个 prompt 末尾）
// ---------------------------------------------------------------------------
export const NO_TEXT_CONSTRAINT = `NO TEXT CONSTRAINT (MANDATORY):
The generated image must contain absolutely no text, letters, words, numbers,
captions, labels, signs, logos, subtitles, handwriting, typography,
or written language of any kind.
Do not visually render the vocabulary word. The concept must be communicated
ONLY through: characters, objects, actions, facial expressions, body language,
and context. Never place the vocabulary word inside the image.`;

// ---------------------------------------------------------------------------
// 场景描述生成器（文字 AI 负责，返回纯图片场景，不含词汇原文）
// ---------------------------------------------------------------------------

/** 场景描述结果 */
export interface VisualScene {
  /** 纯图片场景描述，不含词汇原文 */
  sceneDescription: string;
  /** 视觉策略标签 */
  visualStrategy: "action_scene" | "object_focus" | "relationship" | "story_moment" | "metaphor";
}

/**
 * 根据词条文本和释义生成视觉场景描述。
 * 返回的 sceneDescription 用于图片生成，不包含词汇原文。
 * 例如 protect → "A school-age child protects a small dog from rain by holding an umbrella over the dog."
 */
export function generateVisualScene(
  text: string,
  meaningZh: string,
  type: ContentType
): VisualScene {
  const lower = text.toLowerCase().trim();
  const zh = meaningZh.trim();

  // 简单规则策略：针对常见词汇/短语给出确定性场景
  // 更多词条通过 AI 文本服务补充（在 enrich.ts 中处理）
  const rules: Array<[string[], VisualScene]> = [
    // protect
    [
      ["protect", "保护"],
      { sceneDescription: "A school-age child standing bravely in front of a small frightened puppy, holding a large green umbrella over the dog to shield it from rain. Warm empathetic expression on the child's face. Simple rain background.", visualStrategy: "action_scene" }
    ],
    // look after / take care of
    [
      ["look after", "照顾", "take care of"],
      { sceneDescription: "A kind child gently feeding a small golden retriever puppy from a bowl, while another child watches with a smile. Sunny garden background with flowers.", visualStrategy: "action_scene" }
    ],
    // responsibility
    [
      ["responsibility", "责任"],
      { sceneDescription: "A focused student carefully wiping a classroom whiteboard at the end of the day, while other children pack their bags in the background. Sense of duty and cleanliness.", visualStrategy: "action_scene" }
    ],
    // decision
    [
      ["decision", "决定"],
      { sceneDescription: "A thoughtful student standing at a school hallway intersection, looking at two signs pointing in different directions. One sign shows a book, the other shows a sports ball. Pensive expression.", visualStrategy: "action_scene" }
    ],
    // apple
    [
      ["apple"],
      { sceneDescription: "A shiny red apple sitting on a wooden desk beside an open notebook and pencil. Soft morning light from a window. Clean minimal background.", visualStrategy: "object_focus" }
    ],
    // banana
    [
      ["banana"],
      { sceneDescription: "A bright yellow banana resting on a green leaf, with a few other tropical fruits blurred in the background. Warm tropical colors.", visualStrategy: "object_focus" }
    ],
    // run
    [
      ["run", "跑"],
      { sceneDescription: "A happy child running across a green grassy field toward a finish line ribbon, arms outstretched, sunny day.", visualStrategy: "action_scene" }
    ],
    // read
    [
      ["read", "阅读", "reading"],
      { sceneDescription: "A child sitting cross-legged under a big tree, deeply engrossed in an open storybook, with butterflies floating around. Peaceful afternoon light.", visualStrategy: "action_scene" }
    ],
    // friend
    [
      ["friend", "朋友"],
      { sceneDescription: "Two children of different heights holding hands and smiling at each other on a school playground, with a swing set in the soft-focus background.", visualStrategy: "relationship" }
    ],
    // water
    [
      ["water", "水"],
      { sceneDescription: "Crystal clear water flowing gently over smooth river stones, with sunlight reflecting off the surface. A small fish visible underwater. Natural peaceful scene.", visualStrategy: "object_focus" }
    ],
  ];

  // 优先匹配中文释义
  for (const [keywords, scene] of rules) {
    if (keywords.some((kw) => lower.includes(kw) || zh.includes(kw))) {
      return scene;
    }
  }

  // 默认策略：根据类型返回通用场景模板
  // 注意：这里不直接引用词汇原文，由 AI 文本服务在 enrich.ts 中生成具体场景
  const baseScenes: Record<ContentType, VisualScene> = {
    word: {
      sceneDescription: `A clear, friendly scene showing a recognizable object or action related to the target concept. One main subject, simple setting, no text.`,
      visualStrategy: "object_focus"
    },
    phrase: {
      sceneDescription: `A simple illustrated scene showing a recognizable action or everyday situation. Clear context, friendly characters, no text.`,
      visualStrategy: "action_scene"
    },
    phrasal_verb: {
      sceneDescription: `A cartoon-style scene depicting an action relationship between characters or objects. Dynamic pose, clear cause-effect visual, no text.`,
      visualStrategy: "action_scene"
    },
    sentence: {
      sceneDescription: `A short picture-book illustration capturing one clear moment from a short narrative. Single frame, easy to understand, no text.`,
      visualStrategy: "story_moment"
    },
    expression: {
      sceneDescription: `A simple illustration capturing a common life situation through visual metaphor. Recognizable everyday scene, no text.`,
      visualStrategy: "metaphor"
    }
  };

  return baseScenes[type] ?? baseScenes.word;
}

// ---------------------------------------------------------------------------
// 构建图片 Prompt（分两步：场景描述 + 全局风格）
// ---------------------------------------------------------------------------

export interface BuildImagePromptOpts {
  /** 词汇原文（用于调试日志，不直接放入 prompt 画面描述） */
  word: string;
  /** 内容类型 */
  type: ContentType;
  /** 中文释义（可选，帮助定位场景） */
  meaningZh?: string;
  /** 视觉场景描述（由 generateVisualScene 或 AI 文本服务生成，不含词汇原文） */
  sceneDescription?: string;
  /** 教师自定义指令（补充场景细节；不得覆盖 GLOBAL_STYLE） */
  customInstruction?: string;
}

export function buildImagePrompt(opts: BuildImagePromptOpts): string {
  const { word, type, meaningZh, sceneDescription, customInstruction } = opts;
  // 优先使用显式传入的 sceneDescription；否则用规则策略生成
  const effectiveScene = sceneDescription || generateVisualScene(word, meaningZh || "", type).sceneDescription;
  const parts = [GLOBAL_IMAGE_STYLE, `TEACHING CONTENT:`, `Word/Phrase: ${word}`, `Content Type: ${type}`, `Visual Concept: ${effectiveScene}`];
  if (meaningZh && meaningZh.trim()) {
    parts.push(`Chinese Meaning: ${meaningZh.trim()}`);
  }
  if (customInstruction && customInstruction.trim()) {
    parts.push(`Teacher Custom Instruction: ${customInstruction.trim()}`);
  }
  parts.push("", NO_TEXT_CONSTRAINT);
  parts.push("Important: The image must make the meaning immediately understandable to a student.");
  return parts.filter(Boolean).join("\n");
}

/** 快速生成一个仅含全局风格的兜底 prompt（无自定义场景时） */
export function buildFallbackImagePrompt(word: string, type: ContentType): string {
  const scene = generateVisualScene(word, "", type);
  return buildImagePrompt({
    word,
    type,
    sceneDescription: scene.sceneDescription
  });
}
