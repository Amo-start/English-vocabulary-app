// 课堂状态机：IDLE -> QUESTION_READY -> ANSWER_REVEALING -> ANSWER_VISIBLE -> FEEDBACK
//                    -> QUESTION_TRANSITIONING -> QUESTION_READY ...
// 原则：
//   1. 动画完成由 transitionend/animationend 或 Promise 驱动（见 Classroom.vue），
//      本状态机只负责状态转移合法性，不负责猜时间。
//   2. actionLock 防止快速连续触摸导致状态错乱。
//   3. 任何切题必须经过 QUESTION_TRANSITIONING，且旧题反馈先保存。
import type { ClassroomPhase } from "../types";

export const LOCK_TIMEOUT_MS = 320; // 短锁兜底（防连续点击），真实动画以事件为准

export interface ClassRoomStateMachine {
  phase: ClassroomPhase;
  lock: boolean;
  lockReason: string;
  /** 当前题目序号（1-based） */
  index: number;
  total: number;
}

export function createMachine(total: number): ClassRoomStateMachine {
  return { phase: "IDLE", lock: false, lockReason: "", index: 0, total };
}

export type MachineAction =
  | "START"
  | "REVEAL"
  | "REVEAL_DONE"
  | "FEEDBACK"
  | "NEXT"
  | "NEXT_DONE"
  | "EXIT"
  | "FINISH";

/** 允许的转移表 */
const TRANSITIONS: Partial<Record<ClassroomPhase, MachineAction[]>> = {
  IDLE: ["START"],
  QUESTION_READY: ["REVEAL", "FEEDBACK", "EXIT"],
  ANSWER_REVEALING: ["REVEAL_DONE", "EXIT"],
  ANSWER_VISIBLE: ["FEEDBACK", "NEXT", "EXIT"],
  FEEDBACK: ["NEXT", "REVEAL", "EXIT"],
  QUESTION_TRANSITIONING: ["NEXT_DONE", "EXIT"],
  FINISHED: ["EXIT"]
};

export interface TransitionResult {
  ok: boolean;
  nextPhase?: ClassroomPhase;
  error?: string;
  machine: ClassRoomStateMachine;
}

/** 执行一次状态转移 */
export function transition(
  m: ClassRoomStateMachine,
  action: MachineAction
): TransitionResult {
  const allowed = TRANSITIONS[m.phase] || [];
  if (m.lock) {
    return { ok: false, error: `locked:${m.lockReason}`, machine: m };
  }
  if (!allowed.includes(action)) {
    return { ok: false, error: `invalid transition ${m.phase} + ${action}`, machine: m };
  }
  const next = { ...m };
  switch (action) {
    case "START":
      next.phase = "QUESTION_READY";
      next.index = 1;
      break;
    case "REVEAL":
      next.phase = "ANSWER_REVEALING";
      break;
    case "REVEAL_DONE":
      next.phase = "ANSWER_VISIBLE";
      break;
    case "FEEDBACK":
      next.phase = "FEEDBACK";
      break;
    case "NEXT":
      next.phase = "QUESTION_TRANSITIONING";
      next.index = m.index + 1;
      break;
    case "NEXT_DONE":
      if (m.index > m.total) {
        next.phase = "FINISHED";
      } else {
        next.phase = "QUESTION_READY";
      }
      break;
    case "EXIT":
      next.phase = "IDLE";
      next.index = 0;
      break;
    case "FINISH":
      next.phase = "FINISHED";
      break;
  }
  return { ok: true, nextPhase: next.phase, machine: next };
}

/**
 * 切题入口：教师点击“下一题”时，先保存反馈，再进入过渡态。
 * 返回 { ok, machine }，ok=false 表示当前不允许切题。
 */
export function requestNext(m: ClassRoomStateMachine): TransitionResult {
  return transition(m, "NEXT");
}

/** 标记锁（进入动画等长流程时调用），并携带原因便于排错 */
export function acquireLock(m: ClassRoomStateMachine, reason: string): ClassRoomStateMachine {
  return { ...m, lock: true, lockReason: reason };
}

export function releaseLock(m: ClassRoomStateMachine): ClassRoomStateMachine {
  return { ...m, lock: false, lockReason: "" };
}
