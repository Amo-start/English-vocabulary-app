<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useUiStore } from "../stores/ui";
import { usePacksStore } from "../stores/packs";
import { useReviewStore } from "../stores/review";
import { useClassroomStore } from "../stores/classroom";
import type { ReviewEntry, ContentItem, GameMode } from "../shared/types";
import { GAME_MODES } from "../shared/types";

const ui = useUiStore();
const packs = usePacksStore();
const review = useReviewStore();
const classroom = useClassroomStore();

const packFilter = ref<string>("");
const mode = ref<GameMode>("random");
const rows = ref<Array<{ entry: ReviewEntry; item?: ContentItem; packName: string }>>([]);
const loading = ref(false);

const filteredPacks = computed(() => {
  const ids = new Set(review.entries.map((e) => e.packId));
  return packs.packs.filter((p) => ids.has(p.id));
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    await packs.loadPacks();
    await review.load();
    const entries = packFilter.value
      ? review.entries.filter((e) => e.packId === packFilter.value)
      : review.entries;
    const out: Array<{ entry: ReviewEntry; item?: ContentItem; packName: string }> = [];
    for (const e of entries) {
      const item = await window.api.itemGet(e.itemId);
      const pack = packs.getPack(e.packId);
      out.push({ entry: e, item, packName: pack?.name || "未知词包" });
    }
    rows.value = out;
  } finally {
    loading.value = false;
  }
}

async function replay(): Promise<void> {
  const items = rows.value.map((r) => r.item).filter((x): x is ContentItem => !!x);
  if (!items.length) { ui.toast("没有可练习的词条", "warn"); return; }
  const pack = packs.getPack(rows.value[0].entry.packId);
  if (!pack) return;
  localStorage.setItem("sw:lastPackId", pack.id);
  await classroom.start(pack, items, mode.value, "复习池练习");
  ui.go("classroom");
}

async function remove(id: string): Promise<void> {
  await review.remove(id);
  await load();
}

async function clear(): Promise<void> {
  const ok = await ui.confirm({ title: "清空复习池", message: "确定清空复习池吗？", confirmText: "清空", danger: true });
  if (!ok) return;
  if (packFilter.value) await review.clearPack(packFilter.value);
  else for (const e of [...review.entries]) await review.remove(e.id);
  await load();
}

function reasonLabel(r: string): string {
  const map: Record<string, string> = { "课堂标记重点复习": "课堂重点复习", "teacher-marked": "教师标记", auto: "系统建议" };
  return map[r] || r || "重点复习";
}

function timeStr(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString();
}

onMounted(load);
</script>

<template>
  <div style="max-width: 1000px; margin: 0 auto">
    <div class="row space-between" style="margin-bottom: 16px; flex-wrap: wrap; gap: 12px">
      <div>
        <div class="page-title">🔁 班级复习池</div>
        <div class="page-sub">课堂标记「重点复习」的词条进入这里，随时换一种玩法再练</div>
      </div>
      <div class="row" style="gap: 8px; flex-wrap: wrap">
        <select v-if="filteredPacks.length" v-model="packFilter" style="width: 180px" @change="load">
          <option value="">全部词包</option>
          <option v-for="p in filteredPacks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-model="mode" style="width: 150px">
          <option v-for="g in GAME_MODES" :key="g.id" :value="g.id">{{ g.label }}</option>
        </select>
        <button class="btn btn-primary btn-lg" :disabled="!rows.length" @click="replay">
          ▶ 换一种方式再练（{{ rows.length }} 题）
        </button>
        <button v-if="rows.length" class="btn btn-sm btn-danger" @click="clear">清空</button>
      </div>
    </div>

    <div v-if="loading" class="faint" style="padding: 30px; text-align: center">加载中…</div>
    <div v-else-if="rows.length" class="stack">
      <div v-for="r in rows" :key="r.entry.id" class="card row" style="gap: 14px; flex-wrap: wrap">
        <div class="rv-word">{{ r.item?.text || "（词条已删除）" }}</div>
        <div class="grow">
          <div class="row" style="gap: 6px; flex-wrap: wrap">
            <span class="chip">{{ r.packName }}</span>
            <span class="chip" style="color: var(--warn)">🎯 {{ reasonLabel(r.entry.reason) }}</span>
            <span v-if="r.entry.lastMode" class="chip">上次：{{ GAME_MODES.find((g) => g.id === r.entry.lastMode)?.label }}</span>
            <span class="chip faint">{{ timeStr(r.entry.createdAt) }} 加入</span>
          </div>
          <div v-if="r.item?.meaningZh" class="muted" style="margin-top: 6px">{{ r.item.meaningZh }}</div>
        </div>
        <button class="btn btn-sm btn-danger" @click="remove(r.entry.id)">移除</button>
      </div>
    </div>
    <div v-else class="empty">
      <div class="big">🔁</div>
      <div>复习池是空的</div>
      <div class="faint" style="margin-top: 8px">课堂中标记「重点复习」的词条会自动进入这里</div>
    </div>
  </div>
</template>

<style scoped>
.rv-word { font-size: 20px; font-weight: 700; min-width: 120px; }
</style>
