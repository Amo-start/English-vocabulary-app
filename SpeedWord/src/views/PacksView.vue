<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useUiStore } from "../stores/ui";
import { usePacksStore } from "../stores/packs";
import type { WordPack } from "../shared/types";

const ui = useUiStore();
const packs = usePacksStore();

const showCreate = ref(false);
const newName = ref("");
const newDesc = ref("");
const editing = ref<WordPack | null>(null);

async function create(): Promise<void> {
  if (!newName.value.trim()) { ui.toast("请输入词包名称", "warn"); return; }
  const p = await packs.createPack(newName.value.trim(), newDesc.value.trim());
  ui.toast("词包已创建，去智能创建或手动添加词条", "success");
  showCreate.value = false;
  newName.value = ""; newDesc.value = "";
  ui.go("smart-create", { packId: p.id });
}

async function saveEdit(): Promise<void> {
  if (!editing.value) return;
  await packs.updatePack(editing.value.id, editing.value.name, editing.value.description);
  editing.value = null;
  ui.toast("已保存", "success");
}

async function remove(p: WordPack): Promise<void> {
  const ok = await ui.confirm({
    title: "删除词包",
    message: `确定删除「${p.name}」吗？\n将同时删除词条与课堂记录，不可恢复。`,
    confirmText: "删除",
    danger: true
  });
  if (!ok) return;
  await packs.deletePack(p.id);
  ui.toast("已删除", "success");
}

function openPack(p: WordPack): void {
  localStorage.setItem("sw:lastPackId", p.id);
  ui.go("game-center", { packId: p.id });
}

function edit(p: WordPack): void {
  editing.value = { ...p };
}

function timeStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

onMounted(() => packs.loadPacks());
</script>

<template>
  <div style="max-width: 1100px; margin: 0 auto">
    <div class="row space-between" style="margin-bottom: 20px">
      <div>
        <div class="page-title">我的词包</div>
        <div class="page-sub">共 {{ packs.packs.length }} 个词包</div>
      </div>
      <div class="row">
        <button class="btn btn-ghost" @click="ui.go('smart-create')">✨ 智能创建</button>
        <button class="btn btn-primary" @click="showCreate = true">+ 新建词包</button>
      </div>
    </div>

    <!-- 新建 -->
    <div v-if="showCreate" class="card" style="margin-bottom: 16px">
      <div class="field">
        <label>词包名称</label>
        <input v-model="newName" placeholder="例如：Unit 3 我的学校生活" @keyup.enter="create" />
      </div>
      <div class="field">
        <label>说明（可选）</label>
        <input v-model="newDesc" placeholder="例如：七年级上册 第三单元" />
      </div>
      <div class="row">
        <button class="btn btn-ghost" @click="showCreate = false">取消</button>
        <button class="btn btn-primary" @click="create">创建并添加词条</button>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="packs.packs.length" class="stack">
      <div v-for="p in packs.packs" :key="p.id" class="card pack-row">
        <div class="pack-info grow" @click="openPack(p)">
          <div class="row" style="gap: 8px">
            <span class="text-lg">{{ p.name }}</span>
            <span class="chip">{{ p.itemCount }} 条</span>
            <span class="chip">更新 {{ timeStr(p.updatedAt) }}</span>
          </div>
          <div v-if="p.description" class="faint" style="margin-top: 6px">{{ p.description }}</div>
        </div>
        <div class="row">
          <button class="btn btn-sm" @click="ui.go('item-editor', { packId: p.id })">✏️ 编辑词条</button>
          <button class="btn btn-sm btn-primary" @click="openPack(p)">🎬 开始课堂</button>
          <button class="btn btn-sm btn-icon" title="重命名" style="width:44px;height:44px;min-height:44px" @click="edit(p)">✎</button>
          <button class="btn btn-sm btn-icon btn-danger" title="删除" style="width:44px;height:44px;min-height:44px" @click="remove(p)">🗑</button>
        </div>
      </div>
    </div>
    <div v-else class="empty">
      <div class="big">📚</div>
      <div>还没有词包</div>
      <div class="faint" style="margin-top: 8px">点击右上角「智能创建」或「新建词包」开始</div>
    </div>

    <!-- 重命名弹窗 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal" style="max-width: 420px">
        <h3 style="margin-bottom: 14px">编辑词包</h3>
        <div class="field">
          <label>名称</label>
          <input v-model="editing.name" @keyup.enter="saveEdit" />
        </div>
        <div class="field">
          <label>说明</label>
          <input v-model="editing.description" />
        </div>
        <div class="row space-between">
          <button class="btn btn-ghost" @click="editing = null">取消</button>
          <button class="btn btn-primary" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pack-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pack-info { cursor: pointer; }
</style>
