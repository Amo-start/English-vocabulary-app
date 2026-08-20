<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useUiStore } from "../stores/ui";
import { usePacksStore } from "../stores/packs";
import { useSettingsStore } from "../stores/settings";
import { typeLabel, typeEmoji, detectContentType } from "../shared/type-detect";
import type { ContentItem, ContentType } from "../shared/types";
import { markEdited, lockField, unlockField, fieldStateLabel, type EditableField } from "../shared/fieldstate";
import { mergeEnrichIntoItem } from "../services/enrichMerge";
import { speak, stopSpeak } from "../services/tts";
import ImagePicker from "../components/ImagePicker.vue";

const ui = useUiStore();
const packs = usePacksStore();
const settings = useSettingsStore();

const packId = computed(() => (ui.params.packId as string) || packs.currentPackId);
const pack = computed(() => packs.getPack(packId.value || ""));
const selectedId = ref<string>(ui.params.itemId as string || "");
const selected = computed<ContentItem | undefined>(
  () => packs.items.find((i) => i.id === selectedId.value) || packs.items[0]
);
const busyOne = ref(false);
const busyAll = ref(false);
const showImagePicker = ref(false);

const TYPES: ContentType[] = ["word", "phrase", "phrasal_verb", "sentence", "expression"];

async function load(): Promise<void> {
  if (!packId.value) { ui.go("packs"); return; }
  await packs.loadItems(packId.value);
  if (!selectedId.value && packs.items[0]) selectedId.value = packs.items[0].id;
}

function selectItem(id: string): void { selectedId.value = id; }

// V4.3: 类型切换时，非单词清除音标
function onTypeChange(): void {
  const item = selected.value;
  if (!item) return;
  if (item.type !== "word") {
    item.phonetic = "";
    item.partOfSpeech = "";
  }
  void save(item);
}

function fieldChip(fs: ContentItem["fieldState"], f: EditableField): string {
  return fieldStateLabel(fs[f]);
}

function onFieldInput(item: ContentItem, field: EditableField): void {
  if (item.fieldState[field] !== "locked") {
    item.fieldState = markEdited(item.fieldState, field);
  }
  void save(item);
}

async function save(item: ContentItem): Promise<void> {
  await packs.saveItem(item);
}

async function toggleFieldLock(item: ContentItem, field: EditableField): Promise<void> {
  item.fieldState = item.fieldState[field] === "locked"
    ? unlockField(item.fieldState, field)
    : lockField(item.fieldState, field);
  await save(item);
  ui.toast(fieldChip(item.fieldState, field) === "锁定" ? "已锁定，自动补全不会覆盖" : "已解锁", "success");
}

async function regenField(item: ContentItem, field: EditableField | "memoryHint"): Promise<void> {
  if (field !== "memoryHint" && item.fieldState[field] === "locked") { ui.toast("该字段已锁定，请先解锁再重新生成", "warn"); return; }
  busyOne.value = true;
  try {
    // V4.3: 只传 plain DTO（contentId + text + type + field），避免 Vue reactive proxy 触发 DataCloneError
    const patch = await window.api.aiRegenField({
      contentId: item.id,
      field,
      customInstruction: field === "image" ? (item.image.description || "") : undefined
    });
    const merged = { ...item, ...patch };
    if (field !== "memoryHint") merged.fieldState = markEdited(item.fieldState, field);
    // V4.3: 非单词类型清除音标
    if (field === "phonetic" && item.type !== "word") {
      merged.phonetic = "";
    }
    await packs.saveItem(merged);
    ui.toast("已重新生成", "success");
  } catch (e) {
    ui.toast(`生成失败：${(e as Error).message}`, "error");
  } finally {
    busyOne.value = false;
  }
}

/** 整词条智能补全（遵守 fieldState，验收点 #6） */
async function regenAll(item: ContentItem): Promise<void> {
  busyAll.value = true;
  try {
    const [fresh] = await window.api.aiEnrichItems([{ text: item.text, type: item.type }]);
    const merged = mergeEnrichIntoItem(item, fresh.item);
    const lockedBefore = item.fieldState;
    void lockedBefore;
    await packs.saveItem(merged);
    const kept = item.fieldState.image === "locked" && merged.image.localPath === item.image.localPath;
    ui.toast(`已智能补全（锁定字段保持不动${kept ? "，图片未覆盖" : ""}）`, "success");
  } catch (e) {
    ui.toast(`补全失败：${(e as Error).message}`, "error");
  } finally {
    busyAll.value = false;
  }
}

async function playAudio(item: ContentItem): Promise<void> {
  stopSpeak();
  speak(item.text);
  // 若有词典音频本地缓存则播放
  if (item.audio?.localPath) {
    const a = new Audio(`sw://img/${encodeURIComponent(item.audio.localPath.split(/[\\/]/).pop() || "")}`);
    void a.play().catch(() => { /* TTS 已播放 */ });
  }
}

async function applyImage(res: { localPath: string; sourceType: string; description?: string; sourceUrl?: string }): Promise<void> {
  const item = selected.value;
  if (!item) return;
  if (item.fieldState.image === "locked") { ui.toast("图片已锁定，请先解锁", "warn"); return; }
  item.image = {
    ...item.image,
    localPath: res.localPath,
    sourceType: res.sourceType as ContentItem["image"]["sourceType"],
    sourceUrl: res.sourceUrl,
    description: res.description || item.image.description,
    status: "ok",
    locked: false,
    history: item.image.history || []
  };
  item.fieldState = markEdited(item.fieldState, "image");
  await save(item);
  showImagePicker.value = false;
  ui.toast("图片已更新", "success");
}

async function clearImage(item: ContentItem): Promise<void> {
  if (item.fieldState.image === "locked") { ui.toast("图片已锁定", "warn"); return; }
  item.image = { localPath: "", sourceType: "builtin", sourceUrl: "", description: "", status: "ok", locked: false, history: item.image.history || [] };
  item.fieldState = markEdited(item.fieldState, "image");
  await save(item);
  ui.toast("图片已清除", "success");
}

async function addItem(): Promise<void> {
  const it = packs.newItem(packId.value);
  await packs.saveItem(it);
  selectedId.value = it.id;
}

async function removeItem(item: ContentItem): Promise<void> {
  const ok = await ui.confirm({ title: "删除词条", message: `删除「${item.text}」？`, confirmText: "删除", danger: true });
  if (!ok) return;
  await packs.removeItem(item.id);
  selectedId.value = "";
  ui.toast("已删除", "success");
}

watch(() => ui.params.packId, () => load());
onMounted(load);
</script>

<template>
  <div style="max-width: 1200px; margin: 0 auto">
    <div class="row space-between" style="margin-bottom: 16px">
      <div>
        <div class="page-title">📝 词条编辑</div>
        <div class="page-sub">{{ pack?.name || "词包" }} · {{ packs.items.length }} 个词条</div>
      </div>
      <div class="row">
        <button class="btn btn-ghost" @click="ui.go('packs')">← 返回词包</button>
        <button class="btn btn-primary" @click="addItem">+ 添加词条</button>
      </div>
    </div>

    <div class="editor-layout">
      <!-- 左：词条列表 -->
      <aside class="item-list card">
        <div v-if="!packs.items.length" class="faint" style="padding: 20px; text-align: center">
          还没有词条<br /><button class="btn btn-sm btn-primary" style="margin-top: 10px" @click="addItem">添加词条</button>
        </div>
        <button
          v-for="it in packs.items"
          :key="it.id"
          class="il-item"
          :class="{ active: it.id === selected?.id }"
          @click="selectItem(it.id)"
        >
          <div class="row" style="gap: 8px">
            <span style="font-size: 16px">{{ typeEmoji(it.type) }}</span>
            <span class="grow" style="text-align: left; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ it.text }}</span>
          </div>
          <div class="row" style="gap: 4px; margin-top: 6px; flex-wrap: wrap">
            <span class="chip" :class="it.fieldState.meaningZh">{{ fieldChip(it.fieldState, 'meaningZh') }}</span>
            <span class="chip" :class="it.fieldState.image === 'locked' ? 'locked' : 'auto'">{{ it.fieldState.image === 'locked' ? '图🔒' : '图' }}</span>
            <span v-if="it.locked" class="chip locked">🔒 词条锁定</span>
          </div>
        </button>
      </aside>

      <!-- 右：编辑器 -->
      <section v-if="selected" class="editor card">
        <!-- 顶部：文本 + 类型 -->
        <div class="row" style="gap: 10px; flex-wrap: wrap">
          <input
            :value="selected.text"
            class="text-lg"
            style="flex: 2; min-width: 200px; font-weight: 700"
            @input="selected.text = ($event.target as HTMLInputElement).value; selected.type = detectContentType(selected.text); onFieldInput(selected, 'phonetic')"
          />
          <select v-model="selected.type" style="flex: 1; min-width: 120px" @change="onTypeChange">
            <option v-for="t in TYPES" :key="t" :value="t">{{ typeLabel(t) }}</option>
          </select>
          <button class="btn btn-primary" :disabled="busyAll" @click="regenAll(selected)">
            {{ busyAll ? "补全中…" : "✨ 智能补全" }}
          </button>
        </div>

        <!-- 音标 / 词性 -->
        <div class="grid grid-3" style="margin-top: 14px">
          <div class="field">
            <label>音标
              <span class="chip" :class="selected.fieldState.phonetic">{{ fieldChip(selected.fieldState, 'phonetic') }}</span>
            </label>
            <div class="row" style="gap: 6px">
              <input :value="selected.phonetic" placeholder="/…/" :disabled="selected.fieldState.phonetic === 'locked'" @input="selected.phonetic = ($event.target as HTMLInputElement).value; onFieldInput(selected, 'phonetic')" />
              <button class="btn btn-sm" title="重新获取音标" @click="regenField(selected, 'phonetic')" :disabled="busyOne">🔄</button>
              <button class="btn btn-sm" :class="{ 'locked': selected.fieldState.phonetic === 'locked' }" @click="toggleFieldLock(selected, 'phonetic')">🔒</button>
            </div>
          </div>
          <div class="field">
            <label>词性</label>
            <input :value="selected.partOfSpeech" placeholder="n. / v. / phrase…" @input="selected.partOfSpeech = ($event.target as HTMLInputElement).value; save(selected)" />
          </div>
          <div class="field">
            <label>朗读 / 音频
              <span class="chip" :class="selected.audio.source === 'dict' ? 'edited' : 'auto'">{{ selected.audio.source === 'dict' ? '词典' : 'TTS' }}</span>
            </label>
            <div class="row" style="gap: 6px">
              <button class="btn btn-icon-lg" @click="playAudio(selected)">🔊</button>
              <div class="faint" style="font-size: 12px">Web 语音合成<br />无需音频文件</div>
            </div>
          </div>
        </div>

        <!-- 中文解释 -->
        <div class="field">
          <label>中文解释
            <span class="chip" :class="selected.fieldState.meaningZh">{{ fieldChip(selected.fieldState, 'meaningZh') }}</span>
            <button class="lock-mini" @click="toggleFieldLock(selected, 'meaningZh')">🔒</button>
            <button class="lock-mini" @click="regenField(selected, 'meaningZh')">🔄</button>
          </label>
          <textarea :value="selected.meaningZh" rows="2" :disabled="selected.fieldState.meaningZh === 'locked'" @input="selected.meaningZh = ($event.target as HTMLTextAreaElement).value; onFieldInput(selected, 'meaningZh')" />
        </div>

        <!-- 英文释义 + 例句 -->
        <div class="grid grid-2">
          <div class="field">
            <label>英文释义
              <span class="chip" :class="selected.fieldState.definitionEn">{{ fieldChip(selected.fieldState, 'definitionEn') }}</span>
            </label>
            <textarea :value="selected.definitionEn" rows="3" :disabled="selected.fieldState.definitionEn === 'locked'" @input="selected.definitionEn = ($event.target as HTMLTextAreaElement).value; onFieldInput(selected, 'definitionEn')" />
          </div>
          <div class="field">
            <label>例句
              <span class="chip" :class="selected.fieldState.example">{{ fieldChip(selected.fieldState, 'example') }}</span>
              <button class="lock-mini" @click="toggleFieldLock(selected, 'example')">🔒</button>
              <button class="lock-mini" @click="regenField(selected, 'example')">🔄</button>
            </label>
            <textarea :value="selected.example" rows="3" :disabled="selected.fieldState.example === 'locked'" @input="selected.example = ($event.target as HTMLTextAreaElement).value; onFieldInput(selected, 'example')" />
          </div>
        </div>

        <!-- 记忆提示 -->
        <div class="field" v-if="selected.aiMeta?.memoryHint">
          <label>记忆提示
            <button class="lock-mini" @click="regenField(selected, 'memoryHint')">🔄</button>
          </label>
          <div class="muted" style="background: var(--card-2); padding: 10px 12px; border-radius: 10px">{{ selected.aiMeta.memoryHint }}</div>
        </div>

        <!-- 图片区 -->
        <div class="image-box">
          <div class="row space-between" style="margin-bottom: 10px">
            <label style="font-weight: 700">图片
              <span class="chip">{{ selected.image.sourceType || "无" }}</span>
              <span class="chip" :class="selected.fieldState.image">{{ fieldChip(selected.fieldState, 'image') }}</span>
            </label>
            <div class="row" style="gap: 6px">
              <button class="btn btn-sm" @click="showImagePicker = true">🖼️ 选择图片</button>
              <button class="btn btn-sm" @click="regenField(selected, 'image')" :disabled="busyOne || !settings.isImageAvailable()">🔄 AI 生成</button>
              <button class="btn btn-sm" @click="toggleFieldLock(selected, 'image')">{{ selected.fieldState.image === 'locked' ? '🔓 解锁' : '🔒 锁定' }}</button>
              <button class="btn btn-sm btn-danger" @click="clearImage(selected)">🗑 清除</button>
            </div>
          </div>
          <div class="row" style="gap: 14px; flex-wrap: wrap">
            <div class="img-preview">
              <img v-if="selected.image.localPath" :src="selected.image.localPath" alt="" />
              <div v-else class="img-empty">暂无图片<br />可选图 / 上传 / AI 生成</div>
            </div>
            <div class="grow" style="min-width: 240px">
              <label class="faint" style="font-size: 12px">图片描述（AI 生成 / 重新生成依据）</label>
              <textarea
                :value="selected.image.description || selected.aiMeta?.imageDescription || ''"
                rows="2"
                placeholder="描述场景，例如：一个学生在教室做值日，体现责任感"
                @input="selected.image.description = ($event.target as HTMLTextAreaElement).value; selected.aiMeta = { ...selected.aiMeta, imageDescription: selected.image.description }"
              />
              <div v-if="selected.image.history?.length" class="history-row">
                <span class="faint" style="font-size: 12px">历史版本：</span>
                <button
                  v-for="(h, hi) in selected.image.history"
                  :key="hi"
                  class="hist-thumb"
                  :title="h.description"
                  @click="applyImage({ localPath: h.localPath, sourceType: h.sourceType, description: h.description, sourceUrl: h.sourceUrl })"
                >
                  <img :src="h.localPath" alt="" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 状态行 -->
        <div class="row space-between" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line)">
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <label class="row" style="gap: 6px; cursor: pointer; align-items: center">
              <div class="switch" style="width: 44px; height: 26px" :class="{ on: selected.verified }" @click="selected.verified = !selected.verified; save(selected)" />
              <span class="muted">已核对</span>
            </label>
            <label class="row" style="gap: 6px; cursor: pointer; align-items: center">
              <div class="switch" style="width: 44px; height: 26px" :class="{ on: selected.locked }" @click="selected.locked = !selected.locked; save(selected)" />
              <span class="muted">🔒 整词锁定</span>
            </label>
            <span class="faint" style="font-size: 12px">AI: {{ selected.aiMeta.generatedBy }} · {{ new Date(selected.updatedAt).toLocaleTimeString() }}</span>
          </div>
          <button class="btn btn-danger" @click="removeItem(selected)">🗑 删除词条</button>
        </div>
      </section>
      <div v-else class="empty" style="flex: 1">
        <div class="big">📝</div>
        <div>选择左侧词条开始编辑，或点击右上角「添加词条」</div>
      </div>
    </div>

    <ImagePicker v-if="showImagePicker" :item="selected" @close="showImagePicker = false" @apply="applyImage" />
  </div>
</template>

<style scoped>
.editor-layout { display: flex; gap: 16px; align-items: flex-start; }
.item-list { width: 260px; flex-shrink: 0; padding: 10px; max-height: calc(100vh - 160px); overflow-y: auto; }
.il-item {
  width: 100%; text-align: left; padding: 12px; border-radius: 12px; margin-bottom: 6px;
  background: var(--bg-soft); border: 1px solid transparent; display: block;
}
.il-item.active { border-color: var(--primary); background: var(--primary-soft); }
.editor { flex: 1; min-width: 0; }
.lock-mini { width: 26px; height: 26px; border-radius: 8px; background: var(--card-2); font-size: 13px; margin-left: 6px; opacity: 0.6; }
.lock-mini:hover { opacity: 1; }
.image-box { margin-top: 16px; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--bg-soft); }
.img-preview { width: 220px; height: 150px; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); background: #fff; flex-shrink: 0; }
.img-preview img { width: 100%; height: 100%; object-fit: cover; }
.img-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-faint); text-align: center; font-size: 13px; background: var(--card-2); }
.history-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.hist-thumb { width: 46px; height: 46px; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); padding: 0; }
.hist-thumb img { width: 100%; height: 100%; object-fit: cover; }
</style>
