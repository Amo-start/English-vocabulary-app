// 设置 Store：应用偏好 + AI Provider 配置（不含明文 Key）
//
// 关键约定：传给 IPC 的必须是纯普通对象（plain object），
// 绝不允许把 Vue ref/reactive Proxy 直接传给 ipcRenderer.invoke ——
// 那是 "An object could not be cloned"（DataCloneError）的根本原因。
import { defineStore } from "pinia";
import { ref } from "vue";
import type { AiProviderConfig } from "../shared/types";

const DEFAULT_CONFIG: AiProviderConfig = {
  mode: "cloud",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  textModel: "gpt-4o-mini",
  imageModel: "dall-e-3",
  dictionary: "auto",
  advanced: {
    useIndependentText: false,
    useIndependentImage: false,
    useIndependentDictionary: false,
    text: { baseUrl: "", provider: "", model: "", hasKey: false },
    image: { baseUrl: "", provider: "", model: "", hasKey: false },
    dictionary: { baseUrl: "", provider: "", model: "", hasKey: false }
  },
  hasKey: false
};

/** 把（可能被 Vue 变成 Proxy 的）配置复制成纯普通对象 DTO，Structured-Clone 安全 */
function toPlainConfig(c: AiProviderConfig): AiProviderConfig {
  return {
    mode: c.mode,
    provider: String(c.provider ?? ""),
    baseUrl: String(c.baseUrl ?? ""),
    textModel: String(c.textModel ?? ""),
    imageModel: String(c.imageModel ?? ""),
    dictionary: c.dictionary === "off" ? "off" : "auto",
    advanced: {
      useIndependentText: !!c.advanced?.useIndependentText,
      useIndependentImage: !!c.advanced?.useIndependentImage,
      useIndependentDictionary: !!c.advanced?.useIndependentDictionary,
      text: {
        baseUrl: String(c.advanced?.text?.baseUrl ?? ""),
        provider: String(c.advanced?.text?.provider ?? ""),
        model: String(c.advanced?.text?.model ?? ""),
        hasKey: !!c.advanced?.text?.hasKey
      },
      image: {
        baseUrl: String(c.advanced?.image?.baseUrl ?? ""),
        provider: String(c.advanced?.image?.provider ?? ""),
        model: String(c.advanced?.image?.model ?? ""),
        hasKey: !!c.advanced?.image?.hasKey
      },
      dictionary: {
        baseUrl: String(c.advanced?.dictionary?.baseUrl ?? ""),
        provider: String(c.advanced?.dictionary?.provider ?? ""),
        model: String(c.advanced?.dictionary?.model ?? ""),
        hasKey: !!c.advanced?.dictionary?.hasKey
      }
    },
    hasKey: !!c.hasKey
  };
}

export const useSettingsStore = defineStore("settings", () => {
  const aiConfig = ref<AiProviderConfig>({ ...DEFAULT_CONFIG });
  const loaded = ref(false);

  async function load(): Promise<void> {
    try {
      const cfg = await window.electronAPI.ai.getConfig();
      aiConfig.value = { ...DEFAULT_CONFIG, ...cfg, advanced: { ...DEFAULT_CONFIG.advanced, ...cfg.advanced } };
    } catch (e) {
      // 旧版 preload 兼容：走 window.api（若新命名空间不可用）
      try {
        const cfg = await window.api.aiGetConfig();
        aiConfig.value = { ...DEFAULT_CONFIG, ...cfg, advanced: { ...DEFAULT_CONFIG.advanced, ...cfg.advanced } };
      } catch {
        aiConfig.value = { ...DEFAULT_CONFIG };
      }
    }
    loaded.value = true;
  }

  /** 保存（可附带密钥，密钥单独走 safeStorage 加密）。返回持久化后回读的配置。 */
  async function save(keys?: Record<string, string>): Promise<AiProviderConfig> {
    const payload = toPlainConfig(aiConfig.value);
    const res = await window.electronAPI.ai.saveConfig(payload, keys);
    // 保存后重读，验证持久化并同步 UI（hasKey 等以实际存储为准）
    await load();
    return res.config ?? aiConfig.value;
  }

  function isAiAvailable(): boolean {
    return aiConfig.value.mode !== "off" && !!aiConfig.value.baseUrl && aiConfig.value.hasKey;
  }

  function isImageAvailable(): boolean {
    return isAiAvailable() && !!aiConfig.value.imageModel;
  }

  return { aiConfig, loaded, load, save, isAiAvailable, isImageAvailable };
});
