// 设置 Store：应用偏好 + AI Provider 配置（不含明文 Key）
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

export const useSettingsStore = defineStore("settings", () => {
  const aiConfig = ref<AiProviderConfig>({ ...DEFAULT_CONFIG });
  const loaded = ref(false);

  async function load(): Promise<void> {
    try {
      const cfg = await window.api.aiGetConfig();
      aiConfig.value = { ...DEFAULT_CONFIG, ...cfg, advanced: { ...DEFAULT_CONFIG.advanced, ...cfg.advanced } };
    } catch {
      aiConfig.value = { ...DEFAULT_CONFIG };
    }
    loaded.value = true;
  }

  async function save(keys?: Record<string, string>): Promise<void> {
    await window.api.aiSetConfig(aiConfig.value, keys);
    await load();
  }

  function isAiAvailable(): boolean {
    return aiConfig.value.mode !== "off" && !!aiConfig.value.baseUrl && aiConfig.value.hasKey;
  }

  function isImageAvailable(): boolean {
    return isAiAvailable() && !!aiConfig.value.imageModel;
  }

  return { aiConfig, loaded, load, save, isAiAvailable, isImageAvailable };
});
