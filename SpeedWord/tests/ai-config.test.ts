// AI 配置链纯逻辑：normalizeBaseUrl / Agnes 预设 / sanitizeAiConfig / 错误分类 / resolveAiCfg
// 覆盖 V4 AI 服务配置全链路修复的关键规则（URL 归一化、密钥不落明文、独立服务回落）。
import { describe, it, expect, vi } from "vitest";

// ai.ts → secure-store.ts / db.ts 均 import electron，这里最小桩掉（只用纯函数，不触真实加密）
vi.mock("electron", () => ({
  app: { getPath: () => ".", isPackaged: false, getName: () => "极速识词", getVersion: () => "test" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString("utf8").replace(/^enc:/, "")
  }
}));

import {
  normalizeBaseUrl, AI_PRESETS, presetOf, sanitizeAiConfig, classifyAiError, resolveAiCfg, AiError
} from "../electron/ai";
import type { AiProviderConfig } from "../src/shared/types";

describe("normalizeBaseUrl（trim / 去尾斜杠 / 保留 /v1 / 不重复追加）", () => {
  it("空值返回空串", () => {
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl("   ")).toBe("");
  });
  it("保留已有 /v1", () => {
    expect(normalizeBaseUrl("https://api.agnes-ai.cn/v1")).toBe("https://api.agnes-ai.cn/v1");
  });
  it("去掉尾部多余斜杠", () => {
    expect(normalizeBaseUrl("https://api.agnes-ai.cn/v1///")).toBe("https://api.agnes-ai.cn/v1");
  });
  it("无 /v1 时追加一次", () => {
    expect(normalizeBaseUrl("https://api.openai.com")).toBe("https://api.openai.com/v1");
    expect(normalizeBaseUrl("https://api.openai.com/")).toBe("https://api.openai.com/v1");
    expect(normalizeBaseUrl("http://localhost:11434")).toBe("http://localhost:11434/v1");
    expect(normalizeBaseUrl("  https://host/  ")).toBe("https://host/v1");
  });
  it("保留其他版本段（/v2）且不重复追加", () => {
    expect(normalizeBaseUrl("https://host/v2")).toBe("https://host/v2");
  });
});

describe("Agnes AI 预设", () => {
  it("预设包含国内/国际/备用三地址与默认模型", () => {
    const agnes = AI_PRESETS.agnes;
    expect(agnes).toBeDefined();
    expect(agnes.providerName).toBe("Agnes");
    expect(agnes.baseUrls.china).toBe("https://api.agnes-ai.cn/v1");
    expect(agnes.baseUrls.intl).toBe("https://apihub.agnes-ai.com/v1");
    expect(agnes.baseUrls.backup).toBe("https://apihub.agnes-ai.cn/v1");
    expect(agnes.textModel).toBe("agnes-2.5-flash");
    expect(agnes.imageModel).toBe("agnes-image-2.1-flash");
    expect(agnes.defaultRegion).toBe("china");
  });
  it("presetOf 大小写不敏感命中；自定义服务商不命中", () => {
    expect(presetOf("Agnes")).toBeDefined();
    expect(presetOf("agnes")).toBeDefined();
    expect(presetOf("openai")).toBeUndefined();
    expect(presetOf("")).toBeUndefined();
  });
});

describe("sanitizeAiConfig（只存白名单字段 + URL 归一化 + 剥离密钥标记）", () => {
  const config = (extra?: Record<string, unknown>): AiProviderConfig => ({
    mode: "cloud",
    provider: "Agnes",
    baseUrl: "https://api.agnes-ai.cn/v1",
    textModel: "agnes-2.5-flash",
    imageModel: "agnes-image-2.1-flash",
    dictionary: "auto",
    advanced: {
      useIndependentText: true,
      useIndependentImage: false,
      useIndependentDictionary: false,
      text: { baseUrl: "https://api.openai.com", provider: "openai", model: "gpt-4o-mini", hasKey: true },
      image: { baseUrl: "", provider: "", model: "", hasKey: false },
      dictionary: { baseUrl: "", provider: "", model: "", hasKey: false }
    },
    hasKey: true,
    ...extra
  } as AiProviderConfig);

  it("保留合法字段并归一化 URL", () => {
    const clean = sanitizeAiConfig(config());
    expect(clean.provider).toBe("Agnes");
    expect(clean.baseUrl).toBe("https://api.agnes-ai.cn/v1");
    expect(clean.advanced.text.baseUrl).toBe("https://api.openai.com/v1");
    expect(clean.textModel).toBe("agnes-2.5-flash");
  });
  it("剥离 hasKey / apiKey 等敏感或派生字段", () => {
    const clean = sanitizeAiConfig(config({ apiKey: "sk-secret-123", hasKey: true }));
    expect((clean as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    expect(clean.hasKey).toBe(false);
    expect(clean.advanced.text.hasKey).toBe(false);
    expect(clean.advanced.image.hasKey).toBe(false);
  });
  it("非法 mode 回落 cloud；未知字段被丢弃", () => {
    const clean = sanitizeAiConfig(config({ mode: "weird", evil: "x" }));
    expect(clean.mode).toBe("cloud");
    expect((clean as unknown as Record<string, unknown>).evil).toBeUndefined();
  });
});

describe("classifyAiError（HTTP / 网络分类与建议）", () => {
  it("401 → 提示 Key 无效", () => {
    const c = classifyAiError(new AiError("ai_http", "AI 接口错误 (HTTP 401)", 401));
    expect(c.code).toBe("ai_http");
    expect(c.status).toBe(401);
    expect(c.suggestion).toMatch(/Key/);
  });
  it("404 → 提示 URL / 模型名", () => {
    const c = classifyAiError(new AiError("ai_http", "AI 接口错误 (HTTP 404)", 404));
    expect(c.suggestion).toMatch(/\/v1|模型/);
  });
  it("429 → 限流", () => {
    const c = classifyAiError(new AiError("ai_http", "HTTP 429", 429));
    expect(c.suggestion).toMatch(/频繁|额度/);
  });
  it("503 → 服务暂不可用", () => {
    const c = classifyAiError(new AiError("ai_http", "HTTP 503", 503));
    expect(c.suggestion).toMatch(/稍后重试/);
  });
  it("未配置 Key → 明确建议", () => {
    const c = classifyAiError(new AiError("ai_no_key", "未配置 API Key"));
    expect(c.suggestion).toMatch(/填写 API Key/);
  });
  it("超时 → ai_timeout", () => {
    const c = classifyAiError(new AiError("ai_network", "网络请求失败：fetch aborted timeout"));
    expect(c.code).toBe("ai_timeout");
  });
  it("DNS 解析失败 → ai_dns", () => {
    const c = classifyAiError(new AiError("ai_network", "网络请求失败：getaddrinfo ENOTFOUND api.example.com"));
    expect(c.code).toBe("ai_dns");
    expect(c.suggestion).toMatch(/域名|URL/);
  });
  it("连接被拒绝 → ai_connect", () => {
    const c = classifyAiError(new AiError("ai_network", "网络请求失败：connect ECONNREFUSED 127.0.0.1:11434"));
    expect(c.code).toBe("ai_connect");
  });
});

describe("resolveAiCfg（文本/图片独立回落 + 归一化 + mode=off）", () => {
  const base: AiProviderConfig = {
    mode: "cloud",
    provider: "Agnes",
    baseUrl: "https://api.agnes-ai.cn/v1",
    textModel: "agnes-2.5-flash",
    imageModel: "agnes-image-2.1-flash",
    dictionary: "auto",
    advanced: {
      useIndependentText: false,
      useIndependentImage: false,
      useIndependentDictionary: false,
      text: { baseUrl: "", provider: "", model: "", hasKey: false },
      image: { baseUrl: "", provider: "", model: "", hasKey: false },
      dictionary: { baseUrl: "", provider: "", model: "", hasKey: false }
    },
    hasKey: true
  };

  it("默认：文本与图片共用主 URL / 主 Key", () => {
    const cfg = resolveAiCfg(base, { main: "sk-main", text: "", image: "", dictionary: "" });
    expect(cfg.text.baseUrl).toBe("https://api.agnes-ai.cn/v1");
    expect(cfg.image.baseUrl).toBe("https://api.agnes-ai.cn/v1");
    expect(cfg.text.apiKey).toBe("sk-main");
    expect(cfg.image.apiKey).toBe("sk-main");
    expect(cfg.text.model).toBe("agnes-2.5-flash");
    expect(cfg.image.model).toBe("agnes-image-2.1-flash");
    expect(cfg.text.enabled).toBe(true);
  });

  it("独立文本 URL 生效且归一化；独立 Key 缺省回落主 Key", () => {
    const c: AiProviderConfig = {
      ...base,
      advanced: {
        ...base.advanced,
        useIndependentText: true,
        text: { baseUrl: "https://api.openai.com/", provider: "openai", model: "gpt-4o-mini", hasKey: false }
      }
    };
    const cfg = resolveAiCfg(c, { main: "sk-main", text: "", image: "", dictionary: "" });
    expect(cfg.text.baseUrl).toBe("https://api.openai.com/v1");
    expect(cfg.text.apiKey).toBe("sk-main"); // 回落主 Key
    expect(cfg.text.model).toBe("gpt-4o-mini");
  });

  it("mode=off → 全部禁用", () => {
    const cfg = resolveAiCfg({ ...base, mode: "off" }, { main: "", text: "", image: "", dictionary: "" });
    expect(cfg.text.enabled).toBe(false);
    expect(cfg.image.enabled).toBe(false);
  });
});
