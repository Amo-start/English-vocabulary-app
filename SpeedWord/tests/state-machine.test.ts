import { describe, it, expect } from "vitest";
import {
  createMachine, transition, requestNext, acquireLock, releaseLock, LOCK_TIMEOUT_MS, safeExit
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

  it("最后一题后 FINISHED（index=total+1 时 NEXT_DONE 触发）", () => {
    let m = transition(createMachine(1), "START").machine;      // index=1, total=1
    m = transition(m, "REVEAL").machine;                        // ANSWER_REVEALING
    m = transition(m, "REVEAL_DONE").machine;                   // ANSWER_VISIBLE
    m = requestNext(m).machine;                                 // QUESTION_TRANSITIONING, index=2
    expect(m.phase).toBe("QUESTION_TRANSITIONING");
    m = transition(m, "NEXT_DONE").machine;
    // V4.6: index(2) > total(1) → FINISHED
    expect(m.phase).toBe("FINISHED");
  });

  it("20题完整流程：第20题后结束", () => {
    let m = transition(createMachine(20), "START").machine; // index=1, QUESTION_READY
    // 模拟19次完整流程（第1~19题），NEXT_DONE 后 index=20
    // V4.6: NEXT_DONE 用 > 而非 >=，确保最后一题(index=total)能进入 QUESTION_READY 展示
    for (let i = 0; i < 19; i++) {
      expect(m.phase).toBe("QUESTION_READY");
      m = transition(m, "REVEAL").machine;                   // ANSWER_REVEALING
      m = transition(m, "REVEAL_DONE").machine;              // ANSWER_VISIBLE
      m = transition(m, "FEEDBACK").machine;                 // FEEDBACK
      m = requestNext(m).machine;                            // QUESTION_TRANSITIONING, index++
      m = transition(m, "NEXT_DONE").machine;                // QUESTION_READY（index <= total）
      expect(m.index).toBe(i + 2);                           // 1→2, 2→3, ..., 18→20
    }
    // 现在 index=20, QUESTION_READY（第20题）
    expect(m.index).toBe(20);
    expect(m.phase).toBe("QUESTION_READY");
    // 第20题完成 → NEXT（index=21）→ NEXT_DONE（21 > 20 → FINISHED）
    m = transition(m, "REVEAL").machine;
    m = transition(m, "REVEAL_DONE").machine;
    m = transition(m, "FEEDBACK").machine;
    m = requestNext(m).machine;                              // index=21
    m = transition(m, "NEXT_DONE").machine;
    expect(m.phase).toBe("FINISHED");
    expect(m.index).toBe(21);
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

  it("EXIT 在 QUESTION_READY 时也可用", () => {
    const m = transition(createMachine(5), "START").machine;
    expect(m.phase).toBe("QUESTION_READY");
    const r = transition(m, "EXIT");
    expect(r.ok).toBe(true);
    expect(r.machine.phase).toBe("IDLE");
  });

  it("safeExit 返回清理函数", () => {
    const m = transition(createMachine(3), "START").machine;
    const { machine, cleanup } = safeExit(m);
    expect(machine.phase).toBe("IDLE");
    expect(typeof cleanup).toBe("function");
    // 调用 cleanup 不报错
    cleanup();
  });

  it("锁超时常量存在（兜底防卡死）", () => {
    expect(LOCK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LOCK_TIMEOUT_MS).toBeLessThan(1000);
  });

  it("NEXT_DONE 边界：index > total 触发 FINISHED", () => {
    let m = transition(createMachine(1), "START").machine;
    m = transition(m, "FEEDBACK").machine;
    m = requestNext(m).machine; // index=2, total=1
    m = transition(m, "NEXT_DONE").machine;
    expect(m.phase).toBe("FINISHED");
  });
});
