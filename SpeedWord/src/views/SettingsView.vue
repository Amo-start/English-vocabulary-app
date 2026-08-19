<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";
import type { AiProviderConfig } from "../shared/types";
import type { ServiceTestResult } from "../shared/api";

const settings = useSettingsStore();
const ui = useUiStore();

// 密钥输入：留空表示不修改；提交后立即清空（不残留明文）
const keys = ref<{ main: string; text: string; image: string; dictionary: string }>({ main: "", text: "", image: "", dictionary: "" });
const showAdvanced = ref(false);
const saving = ref(false);
const testingText = ref(false);
const testingImage = ref(false);
const textResult = ref<ServiceTestResult | null>(null);
const imageResult = ref<ServiceTestResult | null>(null);

const cfg = computed(() => settings.aiConfig);

// ---------- Provider 预设（Agnes / 自定义 OpenAI 兼容；软件不硬编码任何服务商） ----------
const AGNES = {
  label: "Agnes AI",
  provider: "Agnes",
  textModel: "agnes-2.5-flash",
  imageModel: "agnes-image-2.1-flash",
  baseUrls: {
    china: "https://api.agnes-ai.cn/v1",
    intl: "https://apihub.agnes-ai.com/v1",
    backup: "https://apihub.agnes-ai.cn/v1"
  }
};

const REGIONS = [
  { id: "china", label: "🇨🇳 国内", desc: "api.agnes-ai.cn" },
  { id: "intl", label: "🌍 国际", desc: "apihub.agnes-ai.com" },
  { id: "backup", label: "🛡 备用", desc: "apihub.agnes-ai.cn" }
] as const;

const presetId = computed<"agnes" | "custom">(() => {
  const p = (cfg.value.provider || "").trim().toLowerCase();
  return p === "agnes" ? "agnes" : "custom";
});
const isAgnes = computed(() => presetId.value === "agnes");

function currentRegion(): "china" | "intl" | "backup" {
  const b = (cfg.value.baseUrl || "").trim().replace(/\/+$/, "");
  const hit = REGIONS.find((r) => AGNES.baseUrls[r.id] === b);
  return hit ? hit.id : "china";
}

function setPreset(id: "agnes" | "custom"): void {
  if (id === "custom") {
    if (presetId.value === "agnes") cfg.value.provider = "openai-compatible";
    return;
  }
  cfg.value.mode = "cloud";
  cfg.value.provider = AGNES.provider;
  cfg.value.baseUrl = AGNES.baseUrls.china;
  cfg.value.textModel = AGNES.textModel;
  cfg.value.imageModel = AGNES.imageModel;
}

function setRegion(region: "china" | "intl" | "backup"): void {
  cfg.value.baseUrl = AGNES.baseUrls[region];
}

// ---------- 保存 ----------
function keyPlaceholder(has: boolean): string {
  return has ? "•••••••• 已保存（留空表示不修改）" : "输入 API Key";
}

async function saveForm(showToast = true): Promise<boolean> {
  saving.value = true;
  try {
    const k: Record<string, string> = {};
    if (keys.value.main.trim()) k.main = keys.value.main.trim();
    if (keys.value.text.trim()) k.text = keys.value.text.trim();
    if (keys.value.image.trim()) k.image = keys.value.image.trim();
    if (keys.value.dictionary.trim()) k.dictionary = keys.value.dictionary.trim();
    // store.save 内部：纯对象 DTO → IPC → 保存后回读校验
    await settings.save(k);
    keys.value = { main: "", text: "", image: "", dictionary: "" };
    if (showToast) ui.toast("已保存（API Key 已加密存储）", "success");
    return true;
  } catch (e) {
    ui.toast(`保存失败：${(e as Error).message}`, "error");
    return false;
  } finally {
    saving.value = false;
  }
}

// ---------- 真实服务测试（先保存当前表单，保证测的是屏幕上看到的配置） ----------
const ipcFail = (service: "text" | "image", e: unknown): ServiceTestResult => ({
  service,
  success: false,
  code: "ipc_error",
  message: `测试调用失败：${(e as Error).message}`,
  durationMs: 0
});

async function testText(): Promise<void> {
  testingText.value = true;
  textResult.value = null;
  try {
    if (!(await saveForm(false))) return;
    textResult.value = await window.electronAPI.ai.testText();
  } catch (e) {
    textResult.value = ipcFail("text", e);
  } finally {
    testingText.value = false;
  }
}

async function testImage(): Promise<void> {
  testingImage.value = true;
  imageResult.value = null;
  try {
    if (!(await saveForm(false))) return;
    imageResult.value = await window.electronAPI.ai.testImage();
  } catch (e) {
    imageResult.value = ipcFail("image", e);
  } finally {
    testingImage.value = false;
  }
}

// 测试全部：文本与图片并行独立执行，图片失败不阻塞文本结果
async function testAll(): Promise<void> {
  testingText.value = true;
  testingImage.value = true;
  textResult.value = null;
  imageResult.value = null;
  try {
    if (!(await saveForm(false))) return;
    const [t, i] = await Promise.all([
      window.electronAPI.ai.testText(),
      window.electronAPI.ai.testImage()
    ]);
    textResult.value = t;
    imageResult.value = i;
  } catch (e) {
    const err = e as Error;
    if (!textResult.value) textResult.value = ipcFail("text", err);
    if (!imageResult.value) imageResult.value = ipcFail("image", err);
  } finally {
    testingText.value = false;
    testingImage.value = false;
  }
}

function setMode(m: AiProviderConfig["mode"]): void {
  cfg.value.mode = m;
  if (m === "local") {
    cfg.value.baseUrl = cfg.value.baseUrl.includes("localhost") ? cfg.value.baseUrl : "http://localhost:11434/v1";
    cfg.value.provider = "ollama";
  }
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

onMounted(() => settings.load());
</script>

<template>
  <div style="max-width: 860px; margin: 0 auto">
    <div class="page-title">⚙️ 智能服务设置</div>
    <div class="page-sub">
      配置你自己的 AI / 词典 API。<b>未配置时软件照常可用</b>：音标来自内置 IPA 词表，课堂完全离线。
      API Key 使用系统级加密（safeStorage / DPAPI）保存，不写入源码与数据库明文。
    </div>

    <div class="card">
      <!-- 服务商预设 -->
      <div class="field">
        <label>服务商预设</label>
        <div class="seg">
          <button :class="{ active: presetId === 'agnes' }" @click="setPreset('agnes')">⚡ {{ AGNES.label }}（中国可用）</button>
          <button :class="{ active: presetId === 'custom' }" @click="setPreset('custom')">🔧 自定义（OpenAI 兼容）</button>
        </div>
        <div class="hint">预设只是帮你填好地址与模型，你可以随时修改；软件支持任意 OpenAI 兼容服务，不绑定任何服务商。</div>
      </div>

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

      <!-- Agnes 区域选择（仅在 Agnes 预设下显示） -->
      <div v-if="isAgnes" class="field">
        <label>接入区域</label>
        <div class="seg">
          <button
            v-for="r in REGIONS"
            :key="r.id"
            :class="{ active: currentRegion() === r.id }"
            @click="setRegion(r.id)"
          >{{ r.label }}</button>
        </div>
        <div class="hint">国内直连更快；国际 / 备用用于网络受限时切换。切换后 API URL 会自动更新。</div>
      </div>

      <!-- 基本配置 -->
      <div class="field">
        <label>服务商</label>
        <input v-model="cfg.provider" placeholder="Agnes / openai / 其他兼容服务" />
      </div>
      <div class="field">
        <label>API URL（自动补全 /v1，不会重复追加）</label>
        <input v-model="cfg.baseUrl" placeholder="https://api.agnes-ai.cn/v1 或 http://localhost:11434/v1" />
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
          <input v-model="cfg.textModel" placeholder="agnes-2.5-flash / gpt-4o-mini" />
        </div>
        <div class="field">
          <label>图片模型（AI 教学插画）</label>
          <input v-model="cfg.imageModel" placeholder="agnes-image-2.1-flash / dall-e-3，可留空" />
        </div>
      </div>
      <div class="field">
        <label>词典策略</label>
        <div class="seg">
          <button :class="{ active: cfg.dictionary === 'auto' }" @click="cfg.dictionary = 'auto'">自动（内置 IPA + 在线词典补充）</button>
          <button :class="{ active: cfg.dictionary === 'off' }" @click="cfg.dictionary = 'off'">仅内置 IPA</button>
        </div>
        <div class="hint">词典链路独立于 AI：内置 IPA → Free Dictionary API → AI 建议；词典配置不会影响文本/图片服务。</div>
      </div>

      <div class="row" style="gap: 10px; margin-top: 16px; flex-wrap: wrap">
        <button class="btn btn-primary btn-lg" :disabled="saving" @click="saveForm()">{{ saving ? "保存中…" : "💾 保存设置" }}</button>
        <button class="btn btn-ghost btn-lg" :disabled="testingText || saving" @click="testText">
          {{ testingText ? "测试中…" : "📝 测试文本服务" }}
        </button>
        <button class="btn btn-ghost btn-lg" :disabled="testingImage || saving" @click="testImage">
          {{ testingImage ? "测试中…" : "🖼️ 测试图片服务" }}
        </button>
        <button class="btn btn-ghost btn-lg" :disabled="testingText || testingImage || saving" @click="testAll">
          {{ testingText || testingImage ? "测试中…" : "⚡ 测试全部" }}
        </button>
      </div>
      <div class="hint" style="margin-top: 8px">
        测试会先保存当前表单再真实调用接口（文本 POST /chat/completions，图片 POST /images/generations）。
        图片测试会真实生成 1 张图，可能产生少量费用；图片失败不会影响文本测试结果。
      </div>

      <!-- 测试结果 -->
      <div v-if="textResult || imageResult" class="test-result">
        <div v-if="textResult" class="tr-card" :class="textResult.success ? 'ok' : 'bad'">
          <div class="tr-head">
            <span class="tr-title">📝 文本服务</span>
            <span class="tr-badge">{{ textResult.success ? "成功" : "失败" }}</span>
            <span class="tr-meta">{{ fmtMs(textResult.durationMs) }}</span>
          </div>
          <div class="tr-line">{{ textResult.message }}</div>
          <div v-if="textResult.model || textResult.status || textResult.endpoint" class="tr-meta">
            <span v-if="textResult.model">模型 {{ textResult.model }}</span>
            <span v-if="textResult.status"> · HTTP {{ textResult.status }}</span>
            <span v-if="textResult.endpoint"> · {{ textResult.endpoint }}</span>
          </div>
          <div v-if="textResult.code !== 'ok'" class="tr-suggest">💡 {{ textResult.suggestion || `错误码：${textResult.code}` }}</div>
        </div>
        <div v-if="imageResult" class="tr-card" :class="imageResult.success ? 'ok' : 'bad'">
          <div class="tr-head">
            <span class="tr-title">🖼️ 图片服务</span>
            <span class="tr-badge">{{ imageResult.success ? "成功" : "失败" }}</span>
            <span class="tr-meta">{{ fmtMs(imageResult.durationMs) }}</span>
          </div>
          <div class="tr-line">{{ imageResult.message }}</div>
          <div v-if="imageResult.model || imageResult.status || imageResult.endpoint" class="tr-meta">
            <span v-if="imageResult.model">模型 {{ imageResult.model }}</span>
            <span v-if="imageResult.status"> · HTTP {{ imageResult.status }}</span>
            <span v-if="imageResult.endpoint"> · {{ imageResult.endpoint }}</span>
          </div>
          <div v-if="imageResult.code !== 'ok'" class="tr-suggest">💡 {{ imageResult.suggestion || `错误码：${imageResult.code}` }}</div>
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
          <input v-model="cfg.advanced.text.baseUrl" placeholder="URL（自动补全 /v1）" />
          <input v-model="cfg.advanced.text.model" placeholder="模型" />
          <input v-model="cfg.advanced.text.provider" placeholder="服务商" />
          <input v-model="keys.text" type="password" :placeholder="keyPlaceholder(cfg.advanced.text.hasKey)" />
        </div>

        <label class="row" style="gap: 8px; cursor: pointer; margin: 12px 0">
          <div class="switch" :class="{ on: cfg.advanced.useIndependentImage }" @click="cfg.advanced.useIndependentImage = !cfg.advanced.useIndependentImage" />
          <span>图片服务使用独立 API</span>
        </label>
        <div v-if="cfg.advanced.useIndependentImage" class="grid grid-2">
          <input v-model="cfg.advanced.image.baseUrl" placeholder="URL（自动补全 /v1）" />
          <input v-model="cfg.advanced.image.model" placeholder="模型" />
          <input v-model="cfg.advanced.image.provider" placeholder="服务商" />
          <input v-model="keys.image" type="password" :placeholder="keyPlaceholder(cfg.advanced.image.hasKey)" />
        </div>

        <label class="row" style="gap: 8px; cursor: pointer; margin: 12px 0">
          <div class="switch" :class="{ on: cfg.advanced.useIndependentDictionary }" @click="cfg.advanced.useIndependentDictionary = !cfg.advanced.useIndependentDictionary" />
          <span>词典服务使用独立 API</span>
        </label>
        <div v-if="cfg.advanced.useIndependentDictionary" class="grid grid-2">
          <input v-model="cfg.advanced.dictionary.baseUrl" placeholder="URL（预留 Oxford/Cambridge，自动补全 /v1）" />
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
.test-result { margin-top: 16px; display: grid; gap: 10px; }
.tr-card { padding: 12px 14px; border-radius: 12px; background: var(--bg-soft); border: 1px solid var(--line); }
.tr-card.ok { border-color: rgba(157, 240, 196, 0.35); }
.tr-card.bad { border-color: rgba(255, 125, 110, 0.35); }
.tr-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.tr-title { font-weight: 600; font-size: 15px; }
.tr-badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.tr-card.ok .tr-badge { background: rgba(157, 240, 196, 0.15); color: #9df0c4; }
.tr-card.bad .tr-badge { background: rgba(255, 125, 110, 0.15); color: #ffd7d4; }
.tr-meta { font-size: 12px; color: var(--muted, #8a94a6); margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.tr-line { font-size: 14px; line-height: 1.6; }
.tr-suggest { margin-top: 6px; font-size: 13px; color: #ffd7a0; }
</style>
