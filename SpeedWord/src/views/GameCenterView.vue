<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useUiStore } from "../stores/ui";
import { usePacksStore } from "../stores/packs";
import { useClassroomStore } from "../stores/classroom";
import { GAME_MODES, type GameMode } from "../shared/types";

const ui = useUiStore();
const packs = usePacksStore();
const classroom = useClassroomStore();

const packId = ref<string>((ui.params.packId as string) || localStorage.getItem("sw:lastPackId") || "");
const mode = ref<GameMode>("quick-read");
const className = ref("");
const fullscreen = ref(true);

const selectedPack = computed(() => packs.getPack(packId.value));
const itemCount = computed(() => selectedPack.value?.itemCount || 0);

async function startGame(): Promise<void> {
  if (!packId.value) { ui.toast("请先选择词包", "warn"); return; }
  const items = await packs.loadItems(packId.value);
  if (!items.length) { ui.toast("这个词包还没有词条，请先添加", "warn"); ui.go("item-editor", { packId: packId.value }); return; }
  const p = packs.getPack(packId.value)!;
  localStorage.setItem("sw:lastPackId", packId.value);
  await classroom.start(p, items, mode.value, className.value.trim());
  ui.go("classroom");
}

onMounted(() => packs.loadPacks());
</script>

<template>
  <div style="max-width: 1080px; margin: 0 auto">
    <div class="page-title">🎮 课堂游戏中心</div>
    <div class="page-sub">选择词包与玩法，一键进入全屏课堂</div>

    <!-- 词包选择 -->
    <div class="card">
      <div class="section-title" style="margin-top: 0">① 选择词包</div>
      <div class="grid grid-2">
        <select v-model="packId" style="min-height: 56px; font-size: 16px">
          <option value="" disabled>选择词包…</option>
          <option v-for="p in packs.packs" :key="p.id" :value="p.id">{{ p.name }}（{{ p.itemCount }} 条）</option>
        </select>
        <button class="btn btn-ghost" @click="ui.go('smart-create')">没有合适的词包？智能创建 →</button>
      </div>
      <div v-if="selectedPack" class="muted" style="margin-top: 8px">
        {{ selectedPack.description || "无说明" }} · 最近更新 {{ new Date(selectedPack.updatedAt).toLocaleString() }}
      </div>
      <div v-if="!itemCount" class="warn" style="color: var(--warn); margin-top: 8px">⚠️ 当前词包没有词条，开始前请先添加</div>
    </div>

    <!-- 玩法选择 -->
    <div class="card" style="margin-top: 16px">
      <div class="section-title" style="margin-top: 0">② 选择玩法</div>
      <div class="grid grid-2 mode-grid">
        <button
          v-for="g in GAME_MODES"
          :key="g.id"
          class="mode-card"
          :class="{ active: mode === g.id }"
          @click="mode = g.id"
        >
          <span class="mode-emoji">{{ g.emoji }}</span>
          <div>
            <div class="mode-label">{{ g.label }}</div>
            <div class="faint" style="font-size: 13px">{{ g.desc }}</div>
          </div>
          <span v-if="mode === g.id" class="mode-check">✓</span>
        </button>
      </div>
    </div>

    <!-- 课堂设置 -->
    <div class="card" style="margin-top: 16px">
      <div class="row" style="gap: 20px; flex-wrap: wrap; align-items: flex-end">
        <div class="field" style="flex: 1; min-width: 200px; margin: 0">
          <label>课堂名称（可选）</label>
          <input v-model="className" placeholder="例如：3班 · 第三单元" />
        </div>
        <label class="row" style="gap: 8px; cursor: pointer; align-items: center">
          <div class="switch" :class="{ on: fullscreen }" @click="fullscreen = !fullscreen" />
          <span class="muted">进入全屏</span>
        </label>
      </div>

      <button
        class="btn btn-primary btn-xl"
        style="width: 100%; margin-top: 18px"
        :disabled="!packId || !itemCount"
        @click="startGame"
      >
        🚀 开始课堂（{{ selectedPack?.name || "" }} · {{ GAME_MODES.find((g) => g.id === mode)?.label }}）
      </button>
      <div class="row" style="justify-content: center; gap: 12px; margin-top: 12px">
        <kbd>Space</kbd><span class="faint">揭晓</span>
        <kbd>Enter</kbd><span class="faint">显示答案</span>
        <kbd>←→</kbd><span class="faint">上一题/下一题</span>
        <kbd>Esc</kbd><span class="faint">退出课堂</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mode-grid { grid-template-columns: repeat(2, 1fr); }
.mode-card {
  display: flex; align-items: center; gap: 14px; padding: 16px; text-align: left;
  border: 1px solid var(--line); border-radius: 14px; background: var(--bg-soft);
  min-height: 84px; position: relative;
}
.mode-card:hover { border-color: var(--text-faint); }
.mode-card.active { border-color: var(--primary); background: var(--primary-soft); }
.mode-emoji { font-size: 32px; }
.mode-label { font-weight: 700; font-size: 17px; margin-bottom: 4px; }
.mode-check { position: absolute; top: 10px; right: 12px; color: var(--primary); font-weight: 800; font-size: 18px; }
</style>
