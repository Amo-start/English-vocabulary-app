import { describe, it, expect } from "vitest";
import {
  createMachine, transition, requestNext, acquireLock, releaseLock, LOCK_TIMEOUT_MS
} from "../src/shared/game/state-machine";

describe("课堂状态机", () => {
  it("START 进入 QUESTION_READY，index=1", () => {
    const m = createMachine(5);
    const r = transition(m, "START");
    expect(r.ok).toBe(true);
    expect(r.nextPhase).toBe("QUESTION_READY");
    expect(r.machine.index).toBe(1);
  });

  it("REVEAL → REVEAL_DONE → ANSWER_VISIBLE", () => {
    let m = transition(createMachine(3), "START").machine;
    m = transition(m, "REVEAL").machine;
    expect(m.phase).toBe("ANSWER_REVEALING");
    m = transition(m, "REVEAL_DONE").machine;
    expect(m.phase).toBe("ANSWER_VISIBLE");
  });

  it("ANSWER_VISIBLE → FEEDBACK → NEXT → 过渡 → NEXT_DONE → 下一题", () => {
    let m = transition(createMachine(3), "START").machine;
    m = transition(m, "REVEAL").machine;
    m = transition(m, "REVEAL_DONE").machine;
    m = transition(m, "FEEDBACK").machine;
    expect(m.phase).toBe("FEEDBACK");
    m = requestNext(m).machine;
    expect(m.phase).toBe("QUESTION_TRANSITIONING");
    expect(m.index).toBe(2);
    m = transition(m, "NEXT_DONE").machine;
    expect(m.phase).toBe("QUESTION_READY");
    expect(m.index).toBe(2);
  });

  it("最后一题后 FINISHED", () => {
    let m = transition(createMachine(1), "START").machine;      // index=1
    m = transition(m, "REVEAL").machine;                        // ANSWER_REVEALING
    m = transition(m, "REVEAL_DONE").machine;                   // ANSWER_VISIBLE
    m = requestNext(m).machine;                                 // QUESTION_TRANSITIONING, index=2 > total=1
    expect(m.phase).toBe("QUESTION_TRANSITIONING");
    m = transition(m, "NEXT_DONE").machine;
    expect(m.phase).toBe("FINISHED");
  });

  it("非法转移被拒绝（快速连点保护）", () => {
    let m = transition(createMachine(3), "START").machine;
    // QUESTION_READY 时不允许 NEXT（必须先揭示或反馈）
    expect(requestNext(m).ok).toBe(false);
    m = transition(m, "REVEAL").machine; // ANSWER_REVEALING
    // 揭示中不允许 FEEDBACK / NEXT
    expect(transition(m, "FEEDBACK").ok).toBe(false);
    expect(transition(m, "NEXT").ok).toBe(false);
    // 只有 REVEAL_DONE 合法
    m = transition(m, "REVEAL_DONE").machine;
    expect(m.phase).toBe("ANSWER_VISIBLE");
  });

  it("锁阻止任何转移；解锁后恢复", () => {
    let m = acquireLock(createMachine(3), "transition");
    expect(m.lock).toBe(true);
    expect(transition(m, "START").ok).toBe(false);
    m = releaseLock(m);
    expect(transition(m, "START").ok).toBe(true);
  });

  it("EXIT 回到 IDLE", () => {
    let m = transition(createMachine(3), "START").machine;
    m = transition(m, "EXIT").machine;
    expect(m.phase).toBe("IDLE");
    expect(m.index).toBe(0);
  });

  it("锁超时常量存在（兜底防卡死）", () => {
    expect(LOCK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LOCK_TIMEOUT_MS).toBeLessThan(1000);
  });
});
