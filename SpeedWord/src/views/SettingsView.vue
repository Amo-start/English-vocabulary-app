<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";
import type { AiProviderConfig } from "../shared/types";

const settings = useSettingsStore();
const ui = useUiStore();

const keys = ref<{ main: string; text: string; image: string; dictionary: string }>({ main: "", text: "", image: "", dictionary: "" });
const showAdvanced = ref(false);
const testing = ref(false);
const testResult = ref<{ text?: { ok: boolean; message: string }; image?: { ok: boolean; message: string } } | null>(null);
const saving = ref(false);

const cfg = computed(() => settings.aiConfig);

function keyPlaceholder(has: boolean): string {
  return has ? "•••••••• 已保存（留空表示不修改）" : "输入 API Key";
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    // 只把非空的 key 传给主进程
    const k: Record<string, string> = {};
    if (keys.value.main) k.main = keys.value.main;
    if (keys.value.text) k.text = keys.value.text;
    if (keys.value.image) k.image = keys.value.image;
    if (keys.value.dictionary) k.dictionary = keys.value.dictionary;
    await settings.save(k);
    keys.value = { main: "", text: "", image: "", dictionary: "" };
    ui.toast("已保存（API Key 已加密存储）", "success");
  } catch (e) {
    ui.toast(`保存失败：${(e as Error).message}`, "error");
  } finally {
    saving.value = false;
  }
}

async function test(): Promise<void> {
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await window.api.aiTest();
  } catch (e) {
    testResult.value = { text: { ok: false, message: (e as Error).message } };
  } finally {
    testing.value = false;
  }
}

function setMode(m: AiProviderConfig["mode"]): void {
  cfg.value.mode = m;
  if (m === "local") {
    cfg.value.baseUrl = cfg.value.baseUrl.includes("localhost") ? cfg.value.baseUrl : "http://localhost:11434/v1";
    cfg.value.provider = "ollama";
  }
}

onMounted(() => settings.load());
</script>

<template>
  <div style="max-width: 860px; margin: 0 auto">
    <div class="page-title">⚙️ 智能服务设置</div>
    <div class="page-sub">
      配置你自己的 AI / 词典 API。<b>未配置时软件照常可用</b>：音标来自内置 IPA 词表，课堂完全离线。
      API Key 使用系统级加密保存，不会写入源码与数据库明文。
    </div>

    <div class="card">
      <!-- 服务模式 -->
      <div class="field">
        <label>服务模式</label>
        <div class="seg">
          <button :class="{ active: cfg.mode === 'cloud' }" @click="setMode('cloud')">☁️ 云端 API</button>
          <button :class="{ active: cfg.mode === 'local' }" @click="setMode('local')">🖥️ 本地 API（Ollama）</button>
          <button :class="{ active: cfg.mode === 'off' }" @click="setMode('off')">🚫 关闭 AI</button>
        </div>
        <div v-if="cfg.mode === 'local'" class="hint">可选接入 Ollama（http://localhost:11434/v1）；即使本机没有 Ollama，软件也能正常运行。</div>
        <div v-if="cfg.mode === 'off'" class="hint">关闭后仅使用内置词典与本地数据，完全离线。</div>
      </div>

      <!-- 基本配置 -->
      <div class="field">
        <label>服务商</label>
        <input v-model="cfg.provider" placeholder="openai / 其他兼容服务 / 自定义" />
      </div>
      <div class="field">
        <label>API URL</label>
        <input v-model="cfg.baseUrl" placeholder="https://api.openai.com/v1 或 http://localhost:11434/v1" />
      </div>
      <div class="field">
        <label>API Key（safeStorage 加密保存）</label>
        <input
          v-model="keys.main"
          type="password"
          autocomplete="off"
          :placeholder="keyPlaceholder(cfg.hasKey)"
        />
        <div class="hint">{{ cfg.hasKey ? "✅ 已配置密钥（加密存储，不会明文显示）" : "未配置密钥" }}</div>
      </div>
      <div class="grid grid-2">
        <div class="field">
          <label>文本模型（中文解释 / 例句 / 教学提示）</label>
          <input v-model="cfg.textModel" placeholder="gpt-4o-mini" />
        </div>
        <div class="field">
          <label>图片模型（AI 教学插画）</label>
          <input v-model="cfg.imageModel" placeholder="dall-e-3 或可留空" />
        </div>
      </div>
      <div class="field">
        <label>词典策略</label>
        <div class="seg">
          <button :class="{ active: cfg.dictionary === 'auto' }" @click="cfg.dictionary = 'auto'">自动（内置 IPA + 在线词典补充）</button>
          <button :class="{ active: cfg.dictionary === 'off' }" @click="cfg.dictionary = 'off'">仅内置 IPA</button>
        </div>
        <div class="hint">AI 不作为音标唯一权威来源；在线词典（Free Dictionary API）自动补充词性/释义/发音。</div>
      </div>

      <div class="row" style="gap: 10px; margin-top: 16px">
        <button class="btn btn-primary btn-lg" :disabled="saving" @click="save">{{ saving ? "保存中…" : "💾 保存设置" }}</button>
        <button class="btn btn-ghost btn-lg" :disabled="testing" @click="test">{{ testing ? "测试中…" : "🔌 测试连接" }}</button>
      </div>

      <!-- 测试结果 -->
      <div v-if="testResult" class="test-result">
        <div class="tr-item" :class="testResult.text?.ok ? 'ok' : 'bad'">
          <span>📝 文本服务：</span>{{ testResult.text?.message || "未测试" }}
        </div>
        <div class="tr-item" :class="testResult.image?.ok ? 'ok' : 'bad'">
          <span>🖼️ 图片服务：</span>{{ testResult.image?.message || "未测试" }}
        </div>
      </div>
    </div>

    <!-- 高级设置 -->
    <div class="card" style="margin-top: 16px">
      <button class="row space-between" style="width: 100%; text-align: left" @click="showAdvanced = !showAdvanced">
        <span class="section-title" style="margin: 0">▼ 高级设置（独立 Text / Dictionary / Image）</span>
      </button>
      <div v-if="showAdvanced" class="adv-body">
        <label class="row" style="gap: 8px; cursor: pointer; margin: 12px 0">
          <div class="switch" :class="{ on: cfg.advanced.useIndependentText }" @click="cfg.advanced.useIndependentText = !cfg.advanced.useIndependentText" />
          <span>文本服务使用独立 API</span>
        </label>
        <div v-if="cfg.advanced.useIndependentText" class="grid grid-2">
          <input v-model="cfg.advanced.text.baseUrl" placeholder="URL" />
          <input v-model="cfg.advanced.text.model" placeholder="模型" />
          <input v-model="cfg.advanced.text.provider" placeholder="服务商" />
          <input v-model="keys.text" type="password" :placeholder="keyPlaceholder(cfg.advanced.text.hasKey)" />
        </div>

        <label class="row" style="gap: 8px; cursor: pointer; margin: 12px 0">
          <div class="switch" :class="{ on: cfg.advanced.useIndependentImage }" @click="cfg.advanced.useIndependentImage = !cfg.advanced.useIndependentImage" />
          <span>图片服务使用独立 API</span>
        </label>
        <div v-if="cfg.advanced.useIndependentImage" class="grid grid-2">
          <input v-model="cfg.advanced.image.baseUrl" placeholder="URL" />
          <input v-model="cfg.advanced.image.model" placeholder="模型" />
          <input v-model="cfg.advanced.image.provider" placeholder="服务商" />
          <input v-model="keys.image" type="password" :placeholder="keyPlaceholder(cfg.advanced.image.hasKey)" />
        </div>

        <label class="row" style="gap: 8px; cursor: pointer; margin: 12px 0">
          <div class="switch" :class="{ on: cfg.advanced.useIndependentDictionary }" @click="cfg.advanced.useIndependentDictionary = !cfg.advanced.useIndependentDictionary" />
          <span>词典服务使用独立 API</span>
        </label>
        <div v-if="cfg.advanced.useIndependentDictionary" class="grid grid-2">
          <input v-model="cfg.advanced.dictionary.baseUrl" placeholder="URL（预留 Oxford/Cambridge）" />
          <input v-model="cfg.advanced.dictionary.model" placeholder="模型（可选）" />
          <input v-model="cfg.advanced.dictionary.provider" placeholder="服务商" />
          <input v-model="keys.dictionary" type="password" :placeholder="keyPlaceholder(cfg.advanced.dictionary.hasKey)" />
        </div>
      </div>
    </div>

    <!-- 安全说明 -->
    <div class="card" style="margin-top: 16px">
      <div class="section-title" style="margin-top: 0">🔒 安全与离线说明</div>
      <ul class="faint" style="padding-left: 20px; line-height: 1.9">
        <li>API Key 由 Electron safeStorage 加密（Windows 基于 DPAPI），数据库中不存明文。</li>
        <li>渲染界面永远看不到明文 Key；所有 AI 请求在主进程完成。</li>
        <li>课堂运行时完全不依赖 AI；AI 只用于备课时补全内容。</li>
        <li>已生成内容缓存到本机，断网后课堂照常进行。</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.adv-body { border-top: 1px solid var(--line); margin-top: 12px; }
.test-result { margin-top: 16px; padding: 12px; border-radius: 12px; background: var(--bg-soft); }
.tr-item { padding: 6px 0; font-size: 14px; }
.tr-item.ok { color: #9df0c4; }
.tr-item.bad { color: #ffd7d4; }
</style>
