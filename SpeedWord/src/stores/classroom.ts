// 课堂 Store：Session 编排 + 状态机集成 + 班级反馈 + 连击 + 复习池
import { defineStore } from "pinia";
import { ref } from "vue";
import type { ClassroomQuestion } from "../shared/game/question";
import type { ContentItem, WordPack, ClassroomSession, FeedbackSignal, GameMode } from "../shared/types";
import {
  createMachine, transition, acquireLock, releaseLock, type ClassRoomStateMachine, type MachineAction
} from "../shared/game/state-machine";
import { buildQueue } from "../shared/game/queue";
import { buildQuestion, buildQuestionSequence } from "../shared/game/question";
import { uid, now } from "../shared/uuid";
import { useReviewStore } from "./review";

export interface AnswerRecord {
  itemId: string;
  correct: boolean;
}

export const useClassroomStore = defineStore("classroom", () => {
  const session = ref<ClassroomSession | null>(null);
  const pack = ref<WordPack | null>(null);
  const mode = ref<GameMode>("quick-read");
  const queue = ref<ContentItem[]>([]);
  const question = ref<ClassroomQuestion | null>(null);
  const machine = ref<ClassRoomStateMachine>(createMachine(0));

  // 反馈记录（绑定 Session）
  const feedbackMap = ref<Record<string, FeedbackSignal>>({});
  const answerRecords = ref<AnswerRecord[]>([]);

  // 连击 / 正确率
  const combo = ref(0);
  const comboMax = ref(0);
  const correctCount = ref(0);
  const totalAnswered = ref(0);
  const running = ref(false);

  function getCurrentItem(): ContentItem | undefined {
    const i = machine.value.index - 1;
    return queue.value[i];
  }

  /** 开始课堂：创建 Session + 洗牌出题 */
  async function start(p: WordPack, items: ContentItem[], m: GameMode, className = ""): Promise<void> {
    pack.value = p;
    mode.value = m;
    queue.value = buildQueue(items);
    feedbackMap.value = {};
    answerRecords.value = [];
    combo.value = 0;
    comboMax.value = 0;
    correctCount.value = 0;
    totalAnswered.value = 0;
    machine.value = createMachine(queue.value.length);
    const s: ClassroomSession = {
      id: uid("ses"),
      packId: p.id,
      gameMode: m,
      className,
      startedAt: now(),
      itemCount: items.length,
      correctCount: 0,
      comboMax: 0
    };
    await window.api.sessionCreate(s);
    session.value = s;
    // START → QUESTION_READY
    const r = transition(machine.value, "START");
    machine.value = r.machine;
    question.value = buildQuestionForIndex(1);
    running.value = true;
  }

  function buildQuestionForIndex(index: number): ClassroomQuestion | null {
    const item = queue.value[index - 1];
    if (!item) return null;
    // random 模式：每道题动态随机；其余按模式生成
    if (mode.value === "random") {
      return buildQuestion(item, "random", queue.value);
    }
    const seq = buildQuestionSequence([item], mode.value);
    return seq[0];
  }

  /** 执行状态机转移，返回是否允许 */
  function act(action: MachineAction): boolean {
    const r = transition(machine.value, action);
    if (!r.ok) return false;
    machine.value = r.machine;
    // 切题成功后加载新题
    if (action === "NEXT_DONE") {
      if (machine.value.phase === "QUESTION_READY") {
        question.value = buildQuestionForIndex(machine.value.index);
      }
    }
    return true;
  }

  /** 动画/长流程期间加锁，防止快速触摸导致状态错乱（配合 transitionend 驱动） */
  function lock(reason: string): void {
    machine.value = acquireLock(machine.value, reason);
  }
  function unlock(): void {
    machine.value = releaseLock(machine.value);
  }

  /** 教师返回上一题（不经过状态机 NEXT，保留已记录反馈） */
  function goPrev(): boolean {
    if (machine.value.index <= 1) return false;
    const allow = ["QUESTION_READY", "ANSWER_VISIBLE", "FEEDBACK", "ANSWER_REVEALING"].includes(machine.value.phase);
    if (!allow || machine.value.lock) return false;
    machine.value = { ...machine.value, index: machine.value.index - 1, phase: "QUESTION_READY" };
    question.value = buildQuestionForIndex(machine.value.index);
    return true;
  }

  /** 教师记录班级反馈（同时计入连击） */
  async function recordFeedback(signal: FeedbackSignal, correct: boolean): Promise<void> {
    const item = getCurrentItem();
    if (!item || !session.value) return;
    feedbackMap.value[item.id] = signal;
    answerRecords.value.push({ itemId: item.id, correct });
    totalAnswered.value++;
    if (correct) {
      correctCount.value++;
      combo.value++;
      comboMax.value = Math.max(comboMax.value, combo.value);
    } else {
      combo.value = 0;
    }
    // 实时写库（切换前先保存）
    await window.api.feedbackUpsert({
      id: uid("fb"),
      sessionId: session.value.id,
      packId: pack.value?.id || "",
      itemId: item.id,
      signal,
      responseCount: 1,
      correctCount: correct ? 1 : 0,
      notes: "",
      createdAt: now()
    });
  }

  /** 结束课堂：落盘 Session 汇总 + 复习池 */
  async function finish(): Promise<void> {
    if (!session.value) return;
    const reviewStore = useReviewStore();
    // 收集「重点复习」进入复习池
    for (const [itemId, signal] of Object.entries(feedbackMap.value)) {
      if (signal === "review") {
        const item = queue.value.find((q) => q.id === itemId);
        if (item) {
          await reviewStore.add(pack.value?.id || "", itemId, "课堂标记重点复习", session.value.id, mode.value);
        }
      }
    }
    session.value.endedAt = now();
    session.value.correctCount = correctCount.value;
    session.value.comboMax = comboMax.value;
    session.value.summary = {
      total: totalAnswered.value,
      comboMax: comboMax.value,
      feedbackCounts: countFeedback()
    };
    await window.api.sessionUpdate(session.value);
    running.value = false;
  }

  function countFeedback(): Record<string, number> {
    const c: Record<string, number> = { mastered: 0, partial: 0, review: 0, unrated: 0 };
    for (const v of Object.values(feedbackMap.value)) c[v] = (c[v] || 0) + 1;
    return c;
  }

  /** 退出课堂（不完成统计时） */
  async function abort(): Promise<void> {
    if (session.value) {
      session.value.endedAt = now();
      await window.api.sessionUpdate(session.value);
    }
    running.value = false;
    machine.value = createMachine(0);
    question.value = null;
  }

  return {
    session, pack, mode, queue, question, machine,
    feedbackMap, answerRecords, combo, comboMax, correctCount, totalAnswered, running,
    start, act, lock, unlock, goPrev, recordFeedback, finish, abort, getCurrentItem
  };
});
