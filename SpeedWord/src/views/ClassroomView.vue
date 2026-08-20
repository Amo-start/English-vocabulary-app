<script setup lang="ts">
// ============ 全屏课堂（V4.2 重构） ============
// 修复：
//   1. 退出流程：modal 打开时暂停 keyboard handler，exit 幂等
//   2. 进度溢出：index >= total 时直接 FINISHED，不渲染超界题目
//   3. 答案泄露：ANSWER_REVEALING 阶段答案 DOM 不存在，仅 ANSWER_VISIBLE 后出现
//   4. 布局稳定：主内容区 max-height 约束，反馈区始终在视口内
//   5. 防重复点击：busy + lock 双重保护
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useClassroomStore } from "../stores/classroom";
import { useUiStore } from "../stores/ui";
import { usePacksStore } from "../stores/packs";
import { speak, stopSpeak } from "../services/tts";
import { GAME_MODES, PHASE_LABEL } from "../shared/types";
import type { FeedbackSignal } from "../shared/types";

const classroom = useClassroomStore();
const ui = useUiStore();
const packs = usePacksStore();

const cardRef = ref<HTMLElement | null>(null);
const answerRef = ref<HTMLElement | null>(null);
const choicePicked = ref<{ index: number; correct: boolean } | null>(null);
const finished = ref(false);
const exiting = ref(false);
const busy = ref(false);
const modalOpen = ref(false); // V4.2: 追踪 modal 状态，暂停 keyboard handler

// ---------- 派生状态 ----------
const phase = computed(() => classroom.machine.phase);
const index = computed(() => classroom.machine.index);
const total = computed(() => classroom.machine.total);
const q = computed(() => classroom.question);
const modeLabel = computed(() => GAME_MODES.find((g) => g.id === classroom.mode)?.label || classroom.mode);
const isChoice = computed(() => q.value?.kind === "choice");
const transitioning = computed(() => phase.value === "QUESTION_TRANSITIONING");

// V4.2: 答案仅在 ANSWER_VISIBLE 后渲染（不在 DOM 中）
const isRevealed = computed(() =>
  isChoice.value
    ? !!choicePicked.value
    : phase.value === "ANSWER_VISIBLE" || phase.value === "FEEDBACK"
);

// V4.2: 可在揭示状态（仅当未选择选项时）
const canReveal = computed(() => !isChoice.value && phase.value === "QUESTION_READY");

// V4.2: 反馈区可见条件
const showFeedback = computed(() =>
  finished.value
    ? false
    : isChoice.value ? !!choicePicked.value : phase.value === "ANSWER_VISIBLE"
);

// V4.2: 进度安全显示：禁止超过 total
const displayIndex = computed(() => Math.min(index.value, total.value));

const feedbackItems: Array<{ signal: FeedbackSignal; label: string; emoji: string }> = [
  { signal: "mastered", label: "全班掌握", emoji: "✅" },
  { signal: "partial", label: "部分加强", emoji: "🙂" },
  { signal: "review", label: "重点复习", emoji: "🎯" },
  { signal: "unrated", label: "未反馈", emoji: "⏭️" }
];

const summaryCount = computed(() => {
  const s = classroom.session?.summary as { feedbackCounts?: Record<string, number> } | undefined;
  return s?.feedbackCounts || {};
});

// ---------- 动画等待：事件驱动 + 安全阀 ----------
function waitForAnim(el: HTMLElement | null, maxMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (!el) { resolve(); return; }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("animationend", done);
      el.removeEventListener("transitionend", done);
      resolve();
    };
    el.addEventListener("animationend", done);
    el.addEventListener("transitionend", done);
    setTimeout(done, maxMs);
  });
}

// ---------- 出题/揭示 ----------
function playWord(): void {
  const item = q.value?.item;
  if (item) speak(item.text);
}

async function reveal(): Promise<void> {
  if (busy.value || modalOpen.value) return;
  busy.value = true;
  try {
    if (!classroom.act("REVEAL")) return; // ANSWER_REVEALING
    await nextTick();
    await waitForAnim(answerRef.value);    // 等揭示动画结束
    classroom.act("REVEAL_DONE");          // → ANSWER_VISIBLE
    playWord();
  } finally {
    busy.value = false;
  }
}

function pickOption(i: number): void {
  if (modalOpen.value) return;
  if (!q.value || choicePicked.value) return;
  const opts = q.value.options || [];
  if (i < 0 || i >= opts.length) return;
  choicePicked.value = { index: i, correct: i === q.value.answerIndex };
  playWord();
}

function optClass(i: number): Record<string, boolean> {
  if (!choicePicked.value) return {};
  if (i === q.value?.answerIndex) return { correct: true };
  if (i === choicePicked.value.index) return { wrong: true };
  return { dim: true };
}

// ---------- 切题：必须经 QUESTION_TRANSITIONING，动画结束才 NEXT_DONE ----------
async function advance(): Promise<void> {
  if (busy.value || modalOpen.value) return;
  if (!classroom.act("FEEDBACK")) return;          // → FEEDBACK
  if (!classroom.act("NEXT")) return;              // → QUESTION_TRANSITIONING
  classroom.lock("transition");                    // 动画期间拒绝任何快速点击
  try {
    await nextTick();
    await waitForAnim(cardRef.value);              // 等卡片滑出
    classroom.unlock();
    const r = classroom.act("NEXT_DONE");          // → QUESTION_READY 或 FINISHED
    choicePicked.value = null;
    if (r && phase.value === "FINISHED") {
      await classroom.finish();
      finished.value = true;
      stopSpeak();
    }
  } catch {
    classroom.unlock();
  }
}

async function handleFeedback(signal: FeedbackSignal): Promise<void> {
  if (busy.value || finished.value || modalOpen.value) return;
  busy.value = true;
  try {
    const correct = isChoice.value ? !!choicePicked.value?.correct : signal === "mastered";
    await classroom.recordFeedback(signal, correct);
    await advance();
  } finally {
    busy.value = false;
  }
}

async function handleNext(): Promise<void> {
  if (busy.value || finished.value || modalOpen.value) return;
  busy.value = true;
  try {
    // 选项题跳过反馈：仍把正确与否计入连击
    if (isChoice.value && choicePicked.value) {
      await classroom.recordFeedback("unrated", choicePicked.value.correct);
    }
    await advance();
  } finally {
    busy.value = false;
  }
}

function goPrev(): void {
  if (modalOpen.value) return;
  if (classroom.goPrev()) {
    choicePicked.value = null;
    stopSpeak();
  }
}

// ---------- 退出 / 完成（V4.2 完整修复） ----------
async function exitClassroom(): Promise<void> {
  if (exiting.value || modalOpen.value) return;
  exiting.value = true;
  modalOpen.value = true; // 暂停 keyboard handler
  stopSpeak();
  if (finished.value) {
    // 已完成：直接返回，不清理（finish 已在 advance 中调用）
    ui.go("game-center");
    exiting.value = false;
    modalOpen.value = false;
    return;
  }
  const ok = await ui.confirm({
    title: "退出课堂",
    message: "确定退出课堂吗？已反馈的「重点复习」会进入复习池。",
    confirmText: "退出",
    cancelText: "取消",
    danger: true
  });
  if (ok) {
    // 幂等清理
    await classroom.abort();
    finished.value = false;
    choicePicked.value = null;
    ui.go("game-center");
  } else {
    // 用户取消：关闭 modal，恢复游戏
    finished.value = false;
  }
  exiting.value = false;
  modalOpen.value = false;
}

// V4.2: ESC 打开 modal 后不再重复触发 exit
async function showExitConfirm(): Promise<void> {
  if (exiting.value || modalOpen.value) return;
  void exitClassroom();
}

async function restart(): Promise<void> {
  const p = classroom.pack;
  const m = classroom.mode;
  if (!p) return;
  const items = await packs.loadItems(p.id);
  await classroom.start(p, items, m, classroom.session?.className || "");
  finished.value = false;
  choicePicked.value = null;
  stopSpeak();
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

// ---------- 键盘（V4.2: modal 打开时暂停所有游戏快捷键） ----------
function onKey(e: KeyboardEvent): void {
  // V4.2: modal 打开时只处理 Esc/Enter 确认框操作
  if (modalOpen.value) {
    if (e.key === "Escape") {
      e.preventDefault();
      exiting.value = false;
      modalOpen.value = false; // 关闭 modal
    }
    // Enter 由 modal 的确认按钮处理
    return;
  }

  if (finished.value) {
    if (["Escape", "Enter", " "].includes(e.key)) { e.preventDefault(); ui.go("game-center"); }
    return;
  }
  switch (e.key) {
    case " ":
    case "Enter":
      e.preventDefault();
      if (isChoice.value) { if (choicePicked.value) void handleNext(); }
      else if (canReveal.value) void reveal();
      else if (phase.value === "ANSWER_VISIBLE") void handleNext();
      break;
    case "Escape":
      e.preventDefault();
      void showExitConfirm();
      break;
    case "ArrowRight":
      e.preventDefault();
      if (!isChoice.value && canReveal.value) void reveal();
      else if (phase.value === "ANSWER_VISIBLE") void handleNext();
      break;
    case "ArrowLeft":
      e.preventDefault();
      goPrev();
      break;
    case "1": case "2": case "3": case "4": {
      const n = parseInt(e.key) - 1;
      if (isChoice.value && !choicePicked.value) pickOption(n);
      else if (showFeedback.value && feedbackItems[n]) void handleFeedback(feedbackItems[n].signal);
      break;
    }
    case "a": case "b": case "c": case "d": {
      if (isChoice.value && !choicePicked.value) pickOption("abcd".indexOf(e.key));
      break;
    }
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  stopSpeak();
  // V4.2: 组件卸载时强制清理
  void classroom.abort();
});
</script>

<template>
  <div class="classroom">
    <!-- 顶部栏 -->
    <header class="cr-header">
      <div class="cr-left">
        <span class="cr-pill">第 <b>{{ displayIndex }}</b> / {{ total }} 题</span>
        <span class="cr-pill">{{ modeLabel }}</span>
        <span v-if="classroom.session?.className" class="cr-pill">{{ classroom.session.className }}</span>
        <span v-if="phase !== 'IDLE' && phase !== 'FINISHED'" class="cr-pill phase">{{ PHASE_LABEL[phase] }}</span>
      </div>
      <div class="cr-right">
        <div v-if="classroom.combo >= 2" :key="classroom.combo" class="combo-pill">🔥 连击 ×{{ classroom.combo }}</div>
        <button class="cr-btn" @click="toggleFullscreen" title="全屏">⛶</button>
        <button class="cr-btn cr-exit-btn" @click="showExitConfirm" title="退出 (Esc)">✕ 退出</button>
      </div>
    </header>

    <!-- 完成总结 -->
    <div v-if="finished" class="cr-summary">
      <h2 class="sum-title">🎉 本轮完成！</h2>
      <div class="sum-sub">{{ modeLabel }} · 共 {{ total }} 题</div>
      <div class="grid grid-4 summary-grid">
        <div class="sum-card"><div class="sum-num">{{ classroom.totalAnswered }}</div><div class="sum-label">已作答</div></div>
        <div class="sum-card"><div class="sum-num">{{ classroom.correctCount }}</div><div class="sum-label">答对</div></div>
        <div class="sum-card"><div class="sum-num">×{{ classroom.comboMax }}</div><div class="sum-label">最高连击</div></div>
        <div class="sum-card"><div class="sum-num">{{ summaryCount.review || 0 }}</div><div class="sum-label">重点复习</div></div>
      </div>
      <div class="row" style="justify-content: center; gap: 16px; margin-top: 30px; flex-wrap: wrap">
        <button class="btn btn-primary btn-xl" @click="restart">🔄 再来一轮</button>
        <button class="btn btn-ghost btn-xl" @click="ui.go('game-center')">🎮 返回游戏中心</button>
      </div>
      <div class="faint" style="margin-top: 18px">「重点复习」词条已进入班级复习池</div>
    </div>

    <!-- 课堂主体 -->
    <template v-else-if="q && displayIndex <= total">
      <main class="cr-stage">
        <div class="card cr-card" :class="{ 'anim-out': transitioning }" ref="cardRef">
          <div class="card-body" :key="q.item.id">
            <!-- 线索区 -->
            <div v-if="q.kind === 'recall-text'" class="prompt">
              <div class="prompt-text" v-if="q.promptText">{{ q.promptText }}</div>
              <div v-else class="faint">（无释义，显示答案）</div>
            </div>
            <div v-else-if="q.kind === 'picture'" class="prompt">
              <img v-if="q.promptImage" :src="q.promptImage" class="prompt-img" alt="" />
              <div v-else class="prompt-text">{{ q.promptText }}</div>
            </div>
            <div v-else-if="q.kind === 'context'" class="prompt">
              <div v-if="q.promptText" class="context-sent">{{ q.promptText }}</div>
              <div v-else class="context-sent">请根据上下文猜词</div>
              <div v-if="q.contextHint" class="context-hint">💡 首字母：{{ q.contextHint }}</div>
            </div>
            <div v-else-if="q.kind === 'flash'" class="prompt">
              <img v-if="q.promptImage" :src="q.promptImage" class="prompt-img" alt="" />
              <div class="prompt-text">{{ q.promptText }}</div>
              <div v-if="q.showPhonetic && q.item.phonetic" class="phonetic">/{{ q.item.phonetic }}/</div>
            </div>
            <!-- 选项题（含教学化题干） -->
            <div v-if="q.kind === 'choice'" class="options">
              <div v-if="q.questionText" class="question-text">{{ q.questionText }}</div>
              <button
                v-for="(opt, i) in q.options"
                :key="i"
                class="opt"
                :class="optClass(i)"
                @click="pickOption(i)"
              >
                <span class="opt-key">{{ "ABCD"[i] }}</span>
                <span class="opt-text">{{ opt }}</span>
                <span v-if="choicePicked && i === q.answerIndex" class="opt-mark">✓</span>
              </button>
            </div>

            <!-- 答案区（V4.2: 仅在 ANSWER_VISIBLE / FEEDBACK 阶段渲染，ANSWER_REVEALING 阶段不出现） -->
            <div v-if="isRevealed" ref="answerRef" class="answer">
              <div class="answer-word" @click="playWord">{{ q.item.text }} <span class="spk">🔊</span></div>
              <div class="answer-meta">
                <span v-if="q.item.phonetic" class="phonetic">/{{ q.item.phonetic }}/</span>
                <span v-if="q.item.partOfSpeech" class="pos">{{ q.item.partOfSpeech }}</span>
              </div>
              <div v-if="q.item.meaningZh" class="answer-meaning">{{ q.item.meaningZh }}</div>
              <div v-if="q.item.definitionEn" class="answer-def">{{ q.item.definitionEn }}</div>
              <div v-if="q.item.example" class="answer-example">"{{ q.item.example }}"</div>
            </div>
          </div>
        </div>
      </main>

      <!-- 底部操作区（固定预留空间） -->
      <footer class="cr-footer">
        <div v-if="canReveal" class="footer-center">
          <button class="btn btn-primary btn-xl reveal-btn" @click="reveal">
            💡 显示答案 <kbd>Space</kbd>
          </button>
        </div>
        <div v-else-if="showFeedback" class="feedback-bar">
          <button
            v-for="(f, fi) in feedbackItems"
            :key="f.signal"
            class="fb-btn"
            :class="f.signal"
            @click="handleFeedback(f.signal)"
          >
            <span class="fb-emoji">{{ f.emoji }}</span>
            <span class="fb-label">{{ f.label }}</span>
            <kbd>{{ fi + 1 }}</kbd>
          </button>
          <button class="fb-next" @click="handleNext" title="跳过反馈，下一题">
            <span class="fb-emoji">▶</span>
            <span class="fb-label">下一题</span>
            <kbd>Space</kbd>
          </button>
        </div>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.classroom {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: radial-gradient(ellipse at 50% 0%, #1a2940 0%, var(--bg) 55%);
  overflow: hidden;
}

/* ---------- 顶栏 ---------- */
.cr-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  gap: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  background: rgba(11, 17, 27, 0.5);
  z-index: 10;
}
.cr-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cr-right { display: flex; align-items: center; gap: 8px; }
.cr-pill {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 14px;
  color: var(--text-dim);
}
.cr-pill b { color: var(--text); font-size: 16px; }
.cr-pill.phase { color: var(--primary); border-color: var(--primary); }
.cr-btn {
  min-width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--card-2);
  border: 1px solid var(--line);
  font-size: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.cr-btn:hover { border-color: var(--text-faint); }
.cr-exit-btn:hover { border-color: var(--danger); color: var(--danger); }
.combo-pill {
  background: var(--warn-soft);
  color: #ffe3ab;
  border: 1px solid var(--warn);
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 18px;
  font-weight: 800;
  animation: combo-pop 0.3s ease;
}
@keyframes combo-pop {
  0% { transform: scale(0.6); }
  60% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

/* ---------- 舞台（V4.2: 固定高度，不挤压底部） ---------- */
.cr-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 20px;
  min-height: 0;
  /* V4.2: 为主内容区设置最大高度，确保底部 footer 不被挤出视口 */
  max-height: calc(100vh - 140px);
  overflow: hidden;
}
.cr-card {
  width: min(880px, 94%);
  min-height: 280px;
  max-height: calc(100% - 20px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 24px 30px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.card-body { animation: card-in 0.32s ease; }
@keyframes card-in {
  from { opacity: 0; transform: translateY(18px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
.cr-card.anim-out { animation: card-out 0.3s ease forwards; }
@keyframes card-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(-16px) scale(0.98); }
}

/* ---------- 线索 ---------- */
.prompt { display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
.prompt-text {
  font-size: clamp(34px, 7vw, 64px);
  font-weight: 800;
  letter-spacing: 0.5px;
  word-break: break-word;
  line-height: 1.2;
}
.prompt-img {
  /* V4.2: 限制最大高度，不挤压底部反馈区 */
  max-width: min(400px, 60vw);
  max-height: 42vh;
  border-radius: 18px;
  border: 1px solid var(--line);
  background: #fff;
  object-fit: contain;
}
.context-sent { font-size: clamp(20px, 3.4vw, 32px); line-height: 1.6; font-weight: 600; }
.context-hint { font-size: 18px; color: var(--warn); background: var(--warn-soft); padding: 6px 16px; border-radius: 999px; }
.phonetic { color: var(--text-dim); font-size: 18px; }

/* V4.2: 选择题题干 */
.question-text {
  font-size: clamp(18px, 3vw, 26px);
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 10px;
  text-align: center;
}

/* ---------- 选项 ---------- */
.options { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px; width: 100%; }
.opt {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 80px;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 12px 18px;
  font-size: 20px;
  transition: transform 0.08s;
  cursor: pointer;
}
.opt:hover { border-color: var(--text-faint); }
.opt:active { transform: scale(0.97); }
.opt-key {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--card-2);
  font-weight: 800;
  font-size: 18px;
  color: var(--text-dim);
}
.opt-text { flex: 1; text-align: left; word-break: break-word; }
.opt-mark { font-size: 22px; color: var(--success); font-weight: 900; }
.opt.correct { border-color: var(--success); background: var(--success-soft); }
.opt.correct .opt-key { background: var(--success); color: #04200f; }
.opt.wrong { border-color: var(--danger); background: var(--danger-soft); }
.opt.wrong .opt-key { background: var(--danger); color: #fff; }
.opt.dim { opacity: 0.5; }

/* ---------- 答案（V4.2: 揭示动画后出现，不会提前泄露） ---------- */
.answer {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px dashed var(--line);
  text-align: center;
  animation: answer-in 0.35s ease;
}
@keyframes answer-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}
.answer-word { font-size: clamp(34px, 6vw, 52px); font-weight: 800; cursor: pointer; }
.spk { font-size: 0.55em; color: var(--primary); vertical-align: middle; margin-left: 6px; }
.answer-meta { display: flex; justify-content: center; gap: 10px; margin: 8px 0; color: var(--text-dim); }
.answer-meaning { font-size: clamp(20px, 3vw, 28px); font-weight: 700; color: #cfe5ff; margin-top: 6px; }
.answer-def { color: var(--text-dim); margin-top: 8px; font-size: 16px; }
.answer-example { color: var(--text-dim); font-style: italic; margin-top: 8px; font-size: 16px; }

/* ---------- 底部（V4.2: 固定预留，不被内容挤出） ---------- */
.cr-footer {
  padding: 16px 24px 20px;
  flex-shrink: 0;
  /* V4.2: 固定高度区域，确保不超出视口 */
  min-height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.footer-center { display: flex; justify-content: center; }
.reveal-btn {
  min-width: 320px;
  min-height: 80px;
  font-size: 22px;
  animation: pulse 1.8s infinite;
  cursor: pointer;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  50% { box-shadow: 0 0 0 12px rgba(59, 130, 246, 0); }
}
.feedback-bar { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; width: 100%; }
.fb-btn, .fb-next {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 140px;
  min-height: 76px;
  border-radius: 18px;
  font-weight: 700;
  background: var(--card-2);
  border: 1px solid var(--line);
  padding: 10px 16px;
  cursor: pointer;
  transition: transform 0.08s;
}
.fb-btn:hover, .fb-next:hover { border-color: var(--text-faint); transform: scale(1.02); }
.fb-btn:active, .fb-next:active { transform: scale(0.97); }
.fb-emoji { font-size: 24px; }
.fb-label { font-size: 15px; }
.fb-btn.mastered { border-color: var(--success); background: var(--success-soft); color: #b9f4d4; }
.fb-btn.partial { border-color: var(--warn); background: var(--warn-soft); color: #ffe3ab; }
.fb-btn.review { border-color: var(--purple); background: rgba(155, 108, 240, 0.16); color: #d5c2ff; }
.fb-btn.unrated, .fb-next { border-color: var(--line); }
.fb-btn kbd, .fb-next kbd { background: rgba(0,0,0,0.25); }

/* ---------- 总结 ---------- */
.cr-summary {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 30px;
  text-align: center;
  animation: card-in 0.4s ease;
}
.sum-title { font-size: clamp(30px, 5vw, 46px); }
.sum-sub { color: var(--text-dim); font-size: 18px; }
.summary-grid { width: min(720px, 92%); margin-top: 20px; }
.sum-card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 20px 10px; }
.sum-num { font-size: clamp(28px, 4vw, 40px); font-weight: 800; color: var(--primary); }
.sum-label { color: var(--text-dim); margin-top: 4px; }

@media (max-width: 720px) {
  .options { grid-template-columns: 1fr; }
  .fb-btn, .fb-next { min-width: 42%; }
  .cr-stage { max-height: calc(100vh - 130px); }
}
</style>
