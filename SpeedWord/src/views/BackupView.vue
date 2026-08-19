<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useUiStore } from "../stores/ui";
import { usePacksStore } from "../stores/packs";

const ui = useUiStore();
const packs = usePacksStore();

const packId = ref<string>("");
const busy = ref(false);

async function exportPack(): Promise<void> {
  if (!packId.value) { ui.toast("请先选择要导出的词包", "warn"); return; }
  busy.value = true;
  try {
    const r = await window.api.backupExportPack(packId.value);
    if (r.ok) ui.toast(`✅ 词包已导出：${r.path}`, "success", 4000);
    else ui.toast(`导出失败：${r.message || "未知错误"}`, "error");
  } catch (e) {
    ui.toast(`导出失败：${(e as Error).message}`, "error");
  } finally {
    busy.value = false;
  }
}

async function importPack(): Promise<void> {
  busy.value = true;
  try {
    const r = await window.api.backupImportPack();
    if (r.ok) {
      ui.toast(`✅ 已导入词包「${r.packName}」`, "success");
      await packs.loadPacks();
    } else if (r.message) {
      ui.toast(r.message, "warn");
    }
  } catch (e) {
    ui.toast(`导入失败：${(e as Error).message}`, "error");
  } finally {
    busy.value = false;
  }
}

async function exportFull(): Promise<void> {
  busy.value = true;
  try {
    const r = await window.api.backupExportFull();
    if (r.ok) ui.toast(`✅ 全量备份已导出：${r.path}`, "success", 4000);
    else ui.toast(`导出失败：${r.message || "未知错误"}`, "error");
  } catch (e) {
    ui.toast(`导出失败：${(e as Error).message}`, "error");
  } finally {
    busy.value = false;
  }
}

async function importFull(): Promise<void> {
  const ok = await ui.confirm({
    title: "恢复全量备份",
    message: "将用备份文件覆盖当前所有词包、课堂记录与复习池。\n建议先导出当前全量备份再恢复。",
    confirmText: "恢复",
    danger: true
  });
  if (!ok) return;
  busy.value = true;
  try {
    const r = await window.api.backupImportFull();
    if (r.ok) {
      ui.toast("✅ 全量恢复完成", "success");
      await packs.loadPacks();
    } else {
      ui.toast(`恢复失败：${r.message || "未知错误"}`, "error");
    }
  } catch (e) {
    ui.toast(`恢复失败：${(e as Error).message}`, "error");
  } finally {
    busy.value = false;
  }
}

onMounted(() => packs.loadPacks());
</script>

<template>
  <div style="max-width: 860px; margin: 0 auto">
    <div class="page-title">💾 数据备份与恢复</div>
    <div class="page-sub">词包（.swpack）与全量数据可导出为文件，换机或整理后随时恢复。导入失败会自动回滚，不影响现有数据。</div>

    <!-- 词包级 -->
    <div class="card">
      <div class="section-title" style="margin-top: 0">📦 单个词包（.swpack）</div>
      <div class="row" style="gap: 10px; flex-wrap: wrap">
        <select v-model="packId" style="flex: 1; min-width: 220px; min-height: 52px">
          <option value="" disabled>选择要导出的词包…</option>
          <option v-for="p in packs.packs" :key="p.id" :value="p.id">{{ p.name }}（{{ p.itemCount }} 条）</option>
        </select>
        <button class="btn btn-primary btn-lg" :disabled="busy || !packId" @click="exportPack">
          ⬇️ 导出词包
        </button>
      </div>
      <div class="muted" style="margin-top: 10px">
        .swpack 包含词条文本、音标、释义、例句、图片与音频资源，可分享给其他老师。
      </div>
      <div class="divider"></div>
      <div class="row" style="gap: 10px">
        <button class="btn btn-ghost btn-lg" :disabled="busy" @click="importPack">
          ⬆️ 从 .swpack 导入词包
        </button>
      </div>
    </div>

    <!-- 全量 -->
    <div class="card" style="margin-top: 16px">
      <div class="section-title" style="margin-top: 0">🗄️ 全量备份</div>
      <div class="row" style="gap: 10px; flex-wrap: wrap">
        <button class="btn btn-primary btn-lg" :disabled="busy" @click="exportFull">
          ⬇️ 导出全量备份
        </button>
        <button class="btn btn-danger btn-lg" :disabled="busy" @click="importFull">
          ⬆️ 从备份恢复
        </button>
      </div>
      <div class="muted" style="margin-top: 10px">
        全量备份包含所有词包、图片素材、课堂记录与复习池。恢复时会先校验备份完整性，失败自动回滚。
      </div>
    </div>

    <!-- 数据位置 -->
    <div class="card" style="margin-top: 16px">
      <div class="section-title" style="margin-top: 0">📍 数据存储位置</div>
      <div class="muted">所有数据保存在本机应用数据目录（userData）下：词包数据库 speedword.db 与媒体素材文件夹。备份导出的文件由你选择保存位置。</div>
      <div class="faint" style="margin-top: 8px">提示：重装或升级应用不影响 userData，数据仍会保留。</div>
    </div>
  </div>
</template>

<style scoped>
.divider { height: 1px; background: var(--line); margin: 18px 0; }
</style>
