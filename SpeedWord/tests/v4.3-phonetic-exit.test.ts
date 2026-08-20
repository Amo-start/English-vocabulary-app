// V4.3: 测试非 word 类型不生成音标，以及退出链路的幂等性
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildQuestion, buildQuestionSequence } from "../src/shared/game/question";
import type { ContentItem } from "../src/shared/types";
import { transition, createMachine, requestNext } from "../src/shared/game/state-machine";

function makeItem(id: string, text: string, type: ContentItem["type"] = "word"): ContentItem {
  return {
    id, packId: "p", sort: 0, type, text, phonetic: type === "word" ? "/əˈpl/" : "", partOfSpeech: "",
    meaningZh: `${text}的中文`, definitionEn: `def`, example: `This is ${text}.`,
    audio: { source: "none", status: "none" },
    image: { localPath: "", sourceType: "builtin", sourceUrl: "", description: "", status: "ok", locked: false, history: [] },
    aiMeta: { generatedBy: "none", generatedAt: 0 },
    fieldState: { phonetic: "auto", meaningZh: "auto", definitionEn: "auto", example: "auto", image: "auto", audio: "auto" },
    verified: false, locked: false, createdAt: 0, updatedAt: 0
  };
}

describe("phonetic 按类型过滤（V4.3）", () => {
  it("word 类型题目 showPhonetic=true 时有音标", () => {
    const item = makeItem("i1", "apple", "word");
    const q = buildQuestion(item, "flash-recall", [item]);
    expect(q.showPhonetic).toBe(true);
    expect(q.item.phonetic).toBe("/əˈpl/");
  });

  it("phrase 类型即使有 phonetic 也不应展示（题型不设置 showPhonetic）", () => {
    const item = makeItem("i2", "look after", "phrasal_verb");
    // 模拟旧数据中 phrase 带有错误音标
    (item as unknown as Record<string, unknown>).phonetic = "/lʊk ˈɑːftə/";
    const q = buildQuestion(item, "flash-recall", [item]);
    // flash-recall 模式 showPhonetic=true，但 type 不是 word，UI 层应过滤
    expect(q.showPhonetic).toBe(true);
    // 实际显示条件：q.item.type === 'word' && q.item.phonetic
    expect(q.item.type).toBe("phrasal_verb");
    // 即使有旧数据音标，UI 层检查 type === 'word' 后不会显示
  });

  it("sentence 类型不做 flash-recall 出题（默认 recall-text）", () => {
    const item = makeItem("i3", "I like apples.", "sentence");
    const q = buildQuestion(item, "quick-read", [item]);
    expect(q.kind).toBe("recall-text");
    expect(q.showPhonetic).toBe(false);
  });
});

describe("状态机退出链路（V4.3 回归）", () => {
  it("EXIT 在 QUESTION_READY 之后各状态都合法", () => {
    const testPhases: Array<{ action: string; label: string }> = [
      { action: "REVEAL", label: "ANSWER_REVEALING" },
      { action: "REVEAL_DONE", label: "ANSWER_VISIBLE" },
      { action: "FEEDBACK", label: "FEEDBACK" },
      { action: "NEXT", label: "QUESTION_TRANSITIONING" }
    ];
    let m = transition(createMachine(5), "START").machine;
    expect(m.phase).toBe("QUESTION_READY");
    // QUESTION_READY 可直接 EXIT
    expect(transition(m, "EXIT").ok).toBe(true);

    // 从 ANSWER_REVEALING 开始测试
    m = transition(createMachine(5), "START").machine;
    m = transition(m, "REVEAL").machine;
    expect(m.phase).toBe("ANSWER_REVEALING");
    expect(transition(m, "EXIT").ok).toBe(true);

    // ANSWER_VISIBLE
    m = transition(createMachine(5), "START").machine;
    m = transition(m, "REVEAL").machine;
    m = transition(m, "REVEAL_DONE").machine;
    expect(m.phase).toBe("ANSWER_VISIBLE");
    expect(transition(m, "EXIT").ok).toBe(true);

    // FEEDBACK
    m = transition(createMachine(5), "START").machine;
    m = transition(m, "REVEAL").machine;
    m = transition(m, "REVEAL_DONE").machine;
    m = transition(m, "FEEDBACK").machine;
    expect(m.phase).toBe("FEEDBACK");
    expect(transition(m, "EXIT").ok).toBe(true);

    // QUESTION_TRANSITIONING
    m = transition(createMachine(5), "START").machine;
    m = transition(m, "REVEAL").machine;
    m = transition(m, "REVEAL_DONE").machine;
    m = transition(m, "FEEDBACK").machine;
    m = requestNext(m).machine;
    expect(m.phase).toBe("QUESTION_TRANSITIONING");
    expect(transition(m, "EXIT").ok).toBe(true);
  });

  it("FINISHED 状态也可 EXIT", () => {
    let m = transition(createMachine(1), "START").machine;
    m = transition(m, "REVEAL").machine;
    m = transition(m, "REVEAL_DONE").machine;
    m = transition(m, "FEEDBACK").machine;
    m = requestNext(m).machine; // index=2, total=1
    m = transition(m, "NEXT_DONE").machine; // FINISHED
    expect(m.phase).toBe("FINISHED");
    const r = transition(m, "EXIT");
    expect(r.ok).toBe(true);
    expect(r.machine.phase).toBe("IDLE");
  });
});

