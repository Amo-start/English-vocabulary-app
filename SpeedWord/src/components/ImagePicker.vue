<script setup lang="ts">
import { ref, watch } from "vue";
import type { ContentItem } from "../shared/types";
import { useUiStore } from "../stores/ui";
import { useSettingsStore } from "../stores/settings";

const props = defineProps<{ item?: ContentItem }>();
const emit = defineEmits<{
  close: [];
  apply: [res: { localPath: string; sourceType: string; description?: string; sourceUrl?: string }];
}>();

const ui = useUiStore();
const settings = useSettingsStore();

const tab = ref<"search" | "ai" | "upload">("search");
const query = ref(props.item?.text || "");
const hits = ref<Array<{ thumbUrl: string; pageUrl: string; title: string }>>([]);
const searching = ref(false);
const generating = ref(false);
const desc = ref(props.item?.image.description || props.item?.aiMeta?.imageDescription || props.item?.text || "");

async function search(): Promise<void> {
  if (!query.value.trim()) return;
  searching.value = true;
  try {
    hits.value = await window.api.imageSearch(query.value.trim());
    if (!hits.value.length) ui.toast("没有搜到合适图片，试试 AI 生成", "warn");
  } catch (e) {
    ui.toast(`搜索失败：${(e as Error).message}`, "error");
  } finally {
    searching.value = false;
  }
}

async function applyApi(hit: { thumbUrl: string; pageUrl: string; title: string }): Promise<void> {
  try {
    const res = await window.api.imageApplyApi(hit.thumbUrl, hit.pageUrl, query.value.trim());
    emit("apply", { localPath: res.localPath, sourceType: res.sourceType, description: res.description, sourceUrl: res.sourceUrl });
  } catch (e) {
    ui.toast(`下载图片失败：${(e as Error).message}`, "error");
  }
}

async function generate(): Promise<void> {
  if (!desc.value.trim()) { ui.toast("请填写图片描述", "warn"); return; }
  if (!settings.isImageAvailable()) { ui.toast("AI 图片服务未配置", "warn"); return; }
  generating.value = true;
  try {
    // V4.3: 只传 contentId，避免 Vue reactive proxy 触发 DataCloneError
    const res = await window.api.aiRegenImageByDescription({
      contentId: props.item!.id,
      description: desc.value.trim()
    });
    emit("apply", { localPath: res.localPath, sourceType: "ai", description: desc.value.trim(), sourceUrl: res.sourceUrl });
  } catch (e) {
    ui.toast(`生成失败：${(e as Error).message}`, "error");
  } finally {
    generating.value = false;
  }
}

async function upload(): Promise<void> {
  const r = await window.api.imagePickAndImport();
  if (!r.ok || !r.result) {
    if (r.message) ui.toast(r.message, "warn");
    return;
  }
  emit("apply", { localPath: r.result.localPath, sourceType: "user", description: r.result.description });
}

watch(() => props.item?.text, (t) => { if (t && !query.value) query.value = t; });
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal img-picker">
      <div class="row space-between" style="margin-bottom: 14px">
        <h3>选择 / 生成图片 · {{ item?.text || "" }}</h3>
        <button class="btn btn-sm" @click="emit('close')">✕ 关闭</button>
      </div>

      <div class="seg" style="margin-bottom: 14px">
        <button :class="{ active: tab === 'search' }" @click="tab = 'search'">🔍 图片库搜索</button>
        <button :class="{ active: tab === 'ai' }" @click="tab = 'ai'">🤖 AI 生成</button>
        <button :class="{ active: tab === 'upload' }" @click="tab = 'upload'">📁 上传本地</button>
      </div>

      <!-- 搜索 -->
      <div v-if="tab === 'search'">
        <div class="row" style="gap: 8px; margin-bottom: 12px">
          <input v-model="query" placeholder="输入英文关键词搜索" @keyup.enter="search" />
          <button class="btn btn-primary" :disabled="searching" @click="search">{{ searching ? "搜索中…" : "搜索" }}</button>
        </div>
        <div v-if="hits.length" class="hit-grid">
          <button v-for="h in hits" :key="h.thumbUrl" class="hit" @click="applyApi(h)">
            <img :src="h.thumbUrl" alt="" loading="lazy" />
          </button>
        </div>
        <div v-else class="faint" style="padding: 20px; text-align: center">
          {{ searching ? "搜索中…" : "输入关键词开始搜索（免费图片库）" }}
        </div>
      </div>

      <!-- AI 生成 -->
      <div v-if="tab === 'ai'">
        <div class="field">
          <label>图片描述（描述越具体，效果越好）</label>
          <textarea v-model="desc" rows="3" placeholder="例如：一个学生认真完成教室值日，体现责任感" />
        </div>
        <button class="btn btn-primary btn-lg" :disabled="generating || !settings.isImageAvailable()" @click="generate">
          {{ generating ? "生成中…（约 10-30 秒）" : "🤖 根据描述生成图片" }}
        </button>
        <div v-if="!settings.isImageAvailable()" class="faint" style="margin-top: 8px">提示：在「智能服务设置」配置图片模型后可生成</div>
      </div>

      <!-- 上传 -->
      <div v-if="tab === 'upload'" class="upload-box">
        <button class="btn btn-primary btn-lg" @click="upload">📁 选择本地图片上传</button>
        <div class="faint" style="margin-top: 10px">支持 png / jpg / webp / gif / svg，上传后自动缓存到本机</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.img-picker { max-width: 640px; }
.hit-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.hit { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; padding: 0; aspect-ratio: 4/3; }
.hit img { width: 100%; height: 100%; object-fit: cover; }
.hit:hover { border-color: var(--primary); }
.upload-box { text-align: center; padding: 30px; border: 1px dashed var(--line); border-radius: 14px; }
</style>
