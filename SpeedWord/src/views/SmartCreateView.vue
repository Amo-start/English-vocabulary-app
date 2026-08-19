<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useUiStore } from "../stores/ui";
import { usePacksStore } from "../stores/packs";
import { useSettingsStore } from "../stores/settings";
import { parseInputText, typeLabel, typeEmoji } from "../shared/type-detect";
import type { ContentItem, EnrichResult } from "../shared/types";
import { markEdited, lockField, unlockField } from "../shared/fieldstate";
import { speak, stopSpeak } from "../services/tts";

const ui = useUiStore();
const packs = usePacksStore();
const settings = useSettingsStore();

const rawText = ref("");
const targetPackId = ref<string>(ui.params.packId as string || "");
const newPackName = ref("");
const results = ref<EnrichResult[]>([]);
const busy = ref(false);
const progress = reactive({ done: 0, total: 0, current: "" });
const offlineOnly = ref(false);
const saved = ref(false);
const parsedCount = computed(() => parseInputText(rawText.value).lines.length);

const packOptions = computed(() => packs.packs);

async function generate(): Promise<void> {
  const { lines } = parseInputText(rawText.value);
  if (!lines.length) { ui.toast("请先粘贴至少一个单词/词组", "warn"); return; }
  if (!targetPackId.value) {
    // 没有目标词包 → 要求先建
    const name = newPackName.value.trim() || rawText.value.split(/\r?\n/)[0].trim() || "新词包";
    const p = await packs.createPack(name.slice(0, 40), "");
    targetPackId.value = p.id;
  }
  busy.value = true;
  saved.value = false;
  progress.done = 0; progress.total = lines.length;
  const off = window.api.onEnrichProgress((p) => {
    progress.done = p.done; progress.total = p.total; progress.current = p.current;
  });
  try {
    results.value = await window.api.aiEnrichItems(
      lines.map((l) => ({ text: l.text, type: l.type })),
      { offlineOnly: offlineOnly.value }
    );
    for (const r of results.value) r.item.packId = targetPackId.value;
    const errCount = results.value.filter((r) => r.errors.length).length;
    ui.toast(`生成完成：${results.value.length} 条，其中 ${errCount} 条有提示（可手动修正）`, errCount ? "warn" : "success");
  } catch (e) {
    ui.toast(`生成失败：${(e as Error).message}`, "error");
  } finally {
    off();
    busy.value = false;
  }
}

async function save(): Promise<void> {
  if (!targetPackId.value) { ui.toast("缺少目标词包", "error"); return; }
  if (!results.value.length) { ui.toast("没有可保存的内容", "warn"); return; }
  const items = results.value.map((r) => r.item);
  await packs.addItems(targetPackId.value, items);
  saved.value = true;
  ui.toast(`已保存 ${items.length} 个词条到词包`, "success");
}

function reset(): void {
  rawText.value = "";
  results.value = [];
  saved.value = false;
  progress.done = 0; progress.total = 0;
}

function playTts(item: ContentItem): void {
  speak(item.text);
}

function editField(idx: number, field: "meaningZh" | "example" | "phonetic"): void {
  const item = results.value[idx].item;
  if (item.fieldState[field] !== "locked") {
    item.fieldState = markEdited(item.fieldState, field);
  }
}

function toggleLock(item: ContentItem, field: "meaningZh" | "example" | "image"): void {
  item.fieldState = item.fieldState[field] === "locked"
    ? unlockField(item.fieldState, field)
    : lockField(item.fieldState, field);
}

async function regenImage(idx: number): Promise<void> {
  const r = results.value[idx];
  const item = r.item;
  // 生成前先检查 fieldState（image locked 不覆盖）
  if (item.fieldState.image === "locked") { ui.toast("该图片已锁定，自动生成不会覆盖（可先解锁）", "warn"); return; }
  const desc = item.image.description || item.aiMeta.imageDescription || item.text;
  ui.toast(`正在生成图片：${item.text}…`, "info", 1200);
  try {
    const gen = await window.api.aiRegenImageByDescription(item, desc);
    item.image = {
      localPath: gen.localPath,
      sourceType: gen.sourceType as ContentItem["image"]["sourceType"],
      sourceUrl: gen.sourceUrl,
      description: desc,
      status: "ok",
      locked: item.image.locked,
      history: item.image.history || []
    };
    ui.toast("图片已更新", "success");
  } catch (e) {
    ui.toast(`图片生成失败：${(e as Error).message}`, "error");
  }
}

const SAMPLE = `apple
banana
protect
look after
take care of
responsibility`;

function loadSample(): void {
  rawText.value = SAMPLE;
}

onMounted(() => {
  if (!packOptions.value.length) packs.loadPacks();
});
</script>

<template>
  <div style="max-width: 1080px; margin: 0 auto">
    <div class="page-title">✨ 智能创建词包</div>
    <div class="page-sub">只需粘贴内容 → 系统自动补全音标、释义、例句与图片</div>

    <!-- 步骤 1：粘贴内容 -->
    <div class="card">
      <div class="section-title" style="margin-top: 0">① 粘贴单词 / 词组 / 短语 / 句子（每行一个）</div>
      <textarea
        v-model="rawText"
        rows="6"
        placeholder="apple&#10;banana&#10;take care of&#10;I have to take care of my little brother."
      />
      <div class="row space-between" style="margin-top: 10px">
        <div class="row" style="gap: 10px">
          <button class="btn btn-sm" @click="loadSample">📋 填入示例</button>
          <button class="btn btn-sm" @click="rawText = ''">清空</button>
          <span class="faint">{{ parsedCount }} 条将被识别</span>
        </div>
        <label class="row" style="gap: 8px; cursor: pointer">
          <div class="switch" :class="{ on: offlineOnly }" @click="offlineOnly = !offlineOnly" />
          <span class="muted">纯离线（仅内置词典）</span>
        </label>
      </div>

      <!-- 目标词包 -->
      <div class="row" style="margin-top: 16px; gap: 12px; flex-wrap: wrap">
        <select v-if="packOptions.length" v-model="targetPackId" style="width: 260px">
          <option value="" disabled>选择或先创建词包…</option>
          <option v-for="p in packOptions" :key="p.id" :value="p.id">{{ p.name }}（{{ p.itemCount }}）</option>
        </select>
        <input
          v-if="!targetPackId"
          v-model="newPackName"
          placeholder="将自动新建词包，输入词包名（可留空）"
          style="width: 280px"
        />
        <button class="btn btn-primary btn-lg" :disabled="busy || !rawText.trim()" @click="generate">
          {{ busy ? `生成中 ${progress.done}/${progress.total}…` : "🚀 智能生成" }}
        </button>
      </div>
    </div>

    <!-- 进度 -->
    <div v-if="busy" class="card" style="margin-top: 16px">
      <div class="row space-between">
        <span>{{ busy ? `正在补全：${progress.current || "…"}` : "" }}</span>
        <span class="muted">{{ progress.done }}/{{ progress.total }}</span>
      </div>
      <div style="height: 10px; background: var(--card-2); border-radius: 8px; margin-top: 10px; overflow: hidden">
        <div
          style="height: 100%; background: var(--primary); border-radius: 8px; transition: width 0.2s"
          :style="{ width: progress.total ? (progress.done / progress.total * 100) + '%' : '0%' }"
        />
      </div>
    </div>

    <!-- 步骤 2：结果确认 -->
    <div v-if="results.length && !busy" class="card" style="margin-top: 16px">
      <div class="row space-between" style="margin-bottom: 12px">
        <div class="section-title" style="margin: 0">② 查看 / 修正（{{ results.length }} 条）</div>
        <div class="row" style="gap: 8px">
          <button class="btn btn-sm" @click="reset">重置</button>
          <button class="btn btn-primary" @click="save" :disabled="saved">💾 保存到词包</button>
        </div>
      </div>

      <div class="stack">
        <div v-for="(r, idx) in results" :key="r.item.id" class="result-card">
          <!-- 左：图片 / 文本 -->
          <div class="rc-img">
            <img v-if="r.item.image?.localPath" :src="r.item.image.localPath" alt="" />
            <div v-else class="noimg">🖼️</div>
            <div class="row" style="justify-content: center; gap: 6px; margin-top: 6px; flex-wrap: wrap">
              <span class="chip">{{ r.item.image.sourceType || "无" }}</span>
              <span v-if="r.item.fieldState.image === 'locked'" class="chip locked">🔒 锁定</span>
            </div>
          </div>
          <!-- 右：字段 -->
          <div class="rc-body">
            <div class="row" style="gap: 8px; flex-wrap: wrap">
              <span class="rc-word">{{ r.item.text }}</span>
              <span class="chip">{{ typeEmoji(r.item.type) }} {{ typeLabel(r.item.type) }}</span>
              <span v-if="r.item.phonetic" class="chip mono">{{ r.item.phonetic }}</span>
              <button class="btn btn-sm btn-icon" style="width: 40px; height: 40px; min-height: 40px" title="朗读" @click="playTts(r.item)">🔊</button>
              <button class="btn btn-sm" @click="regenImage(idx)" :disabled="!settings.isImageAvailable()">🔄 重新生成图</button>
            </div>

            <div v-for="err in r.errors" :key="err.stage" class="err-line">
              ⚠️ {{ err.message }}
            </div>

            <!-- 释义 -->
            <div class="field-row">
              <label>中文解释
                <button class="lock-btn" :class="{ locked: r.item.fieldState.meaningZh === 'locked' }" @click="toggleLock(r.item, 'meaningZh')">🔒</button>
              </label>
              <textarea
                v-model="r.item.meaningZh"
                rows="2"
                @input="editField(idx, 'meaningZh')"
                :disabled="r.item.fieldState.meaningZh === 'locked'"
              />
            </div>
            <!-- 例句 -->
            <div class="field-row">
              <label>例句
                <button class="lock-btn" :class="{ locked: r.item.fieldState.example === 'locked' }" @click="toggleLock(r.item, 'example')">🔒</button>
              </label>
              <textarea
                v-model="r.item.example"
                rows="2"
                @input="editField(idx, 'example')"
                :disabled="r.item.fieldState.example === 'locked'"
              />
            </div>
            <!-- 记忆提示 -->
            <div v-if="r.item.aiMeta?.memoryHint" class="hint-line">
              💡 记忆提示：{{ r.item.aiMeta.memoryHint }}
            </div>
            <div v-if="r.item.aiMeta?.imageDescription" class="hint-line faint">
              🎨 图片描述：{{ r.item.aiMeta.imageDescription }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="saved" class="saved-banner">
        ✅ 已保存！可以 <button class="btn btn-sm btn-primary" @click="ui.go('item-editor', { packId: targetPackId })">进入词条编辑</button>
        &nbsp;或 <button class="btn btn-sm" @click="ui.go('game-center', { packId: targetPackId })">开始课堂 →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-card { display: flex; gap: 16px; border: 1px solid var(--line); border-radius: 14px; padding: 14px; background: var(--bg-soft); }
.rc-img { width: 150px; flex-shrink: 0; }
.rc-img img { width: 150px; height: 110px; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); background: #fff; }
.noimg { width: 150px; height: 110px; display: flex; align-items: center; justify-content: center; font-size: 40px; background: var(--card-2); border-radius: 10px; }
.rc-body { flex: 1; min-width: 0; }
.rc-word { font-size: 20px; font-weight: 700; }
.field-row { margin-top: 10px; }
.field-row label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
.field-row textarea { font-size: 14px; }
.lock-btn { width: 28px; height: 28px; border-radius: 8px; background: var(--card-2); font-size: 13px; opacity: 0.5; }
.lock-btn.locked { opacity: 1; background: var(--success-soft); }
.err-line { color: var(--warn); font-size: 13px; margin-top: 6px; }
.hint-line { font-size: 13px; margin-top: 6px; color: var(--text-dim); }
.saved-banner { margin-top: 16px; padding: 16px; border-radius: 12px; background: var(--success-soft); color: #b9f4d4; }
</style>
