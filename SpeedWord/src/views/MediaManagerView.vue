<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { usePacksStore } from "../stores/packs";
import { useUiStore } from "../stores/ui";
import type { ContentItem } from "../shared/types";

const packs = usePacksStore();
const ui = useUiStore();

const filter = ref<"all" | "builtin" | "api" | "ai" | "user" | "none">("all");
const itemsWithImages = ref<Array<{ item: ContentItem; packName: string }>>([]);

const SOURCE_LABEL: Record<string, string> = {
  builtin: "内置素材",
  api: "图片API",
  ai: "AI生成",
  user: "教师上传",
  none: "暂无"
};

const filtered = computed(() => {
  if (filter.value === "all") return itemsWithImages.value;
  if (filter.value === "none") return itemsWithImages.value.filter((x) => !x.item.image?.localPath);
  return itemsWithImages.value.filter((x) => x.item.image?.sourceType === filter.value);
});

const counts = computed(() => {
  const c: Record<string, number> = { builtin: 0, api: 0, ai: 0, user: 0, none: 0 };
  for (const x of itemsWithImages.value) {
    const k = x.item.image?.localPath ? x.item.image.sourceType : "none";
    c[k] = (c[k] || 0) + 1;
  }
  return c;
});

async function load(): Promise<void> {
  await packs.loadPacks();
  const all: Array<{ item: ContentItem; packName: string }> = [];
  for (const p of packs.packs) {
    const its = await window.api.itemsList(p.id);
    for (const it of its) all.push({ item: it, packName: p.name });
  }
  itemsWithImages.value = all;
}

function openEditor(item: ContentItem, packId: string): void {
  ui.go("item-editor", { packId, itemId: item.id });
}

onMounted(load);
</script>

<template>
  <div style="max-width: 1200px; margin: 0 auto">
    <div class="page-title">🖼️ 图片素材管理</div>
    <div class="page-sub">所有词条的图片一览：来源清晰、便于检查与替换</div>

    <div class="seg" style="margin-bottom: 16px">
      <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部（{{ itemsWithImages.length }}）</button>
      <button :class="{ active: filter === 'builtin' }" @click="filter = 'builtin'">内置（{{ counts.builtin }}）</button>
      <button :class="{ active: filter === 'api' }" @click="filter = 'api'">图片API（{{ counts.api }}）</button>
      <button :class="{ active: filter === 'ai' }" @click="filter = 'ai'">AI生成（{{ counts.ai }}）</button>
      <button :class="{ active: filter === 'user' }" @click="filter = 'user'">教师上传（{{ counts.user }}）</button>
      <button :class="{ active: filter === 'none' }" @click="filter = 'none'">暂无图（{{ counts.none }}）</button>
    </div>

    <div v-if="filtered.length" class="grid" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
      <button
        v-for="x in filtered"
        :key="x.item.id"
        class="media-card card"
        @click="openEditor(x.item, x.item.packId)"
      >
        <div class="mc-img">
          <img v-if="x.item.image?.localPath" :src="x.item.image.localPath" alt="" />
          <div v-else class="mc-noimg">🖼️</div>
        </div>
        <div class="mc-word">{{ x.item.text }}</div>
        <div class="row" style="justify-content: center; gap: 4px; flex-wrap: wrap">
          <span class="chip">{{ SOURCE_LABEL[x.item.image?.sourceType || "none"] }}</span>
          <span v-if="x.item.fieldState.image === 'locked'" class="chip locked">🔒</span>
          <span class="chip">{{ x.packName }}</span>
        </div>
      </button>
    </div>
    <div v-else class="empty">
      <div class="big">🖼️</div>
      <div>没有图片素材</div>
      <div class="faint" style="margin-top: 8px">去「智能创建」或「词条编辑」给词条配图</div>
    </div>
  </div>
</template>

<style scoped>
.media-card { padding: 12px; text-align: center; cursor: pointer; }
.mc-img { height: 110px; border-radius: 10px; overflow: hidden; background: #fff; border: 1px solid var(--line); margin-bottom: 8px; }
.mc-img img { width: 100%; height: 100%; object-fit: cover; }
.mc-noimg { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 34px; background: var(--card-2); }
.mc-word { font-weight: 600; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
