// AI Provider 统一接口 + OpenAI 兼容实现 + 本地兼容（Ollama）。
// 教师配置自己的 API URL / Key / Model；主进程持有 Key 并完成所有请求。
//
// 本文件同时提供：
//   - normalizeBaseUrl()：URL 归一化（trim、去尾斜杠、保留 /v1、不重复追加）
//   - AI_PRESETS：Agnes AI 等一键预设（软件不硬编码任何单一服务商，预设仅作便捷填充）
//   - testTextService / testImageService：真实调用测试（POST /chat/completions、/images/generations）
//   - classifyAiError()：HTTP/网络错误分类，给出针对性建议
import { readAiConfig } from "./db";
import { getSecret } from "./secure-store";
import type { Db } from "./db";
import type { AiProviderConfig } from "../src/shared/types";

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------

export class AiError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
  }
}

/** HTTP 状态码 → 教学性建议 */
const HTTP_HINTS: Record<number, string> = {
  400: "请求参数有误：检查模型名、尺寸参数与 URL 是否正确",
  401: "API Key 无效或已过期：请重新填写并保存",
  403: "权限不足：该 Key 无权访问此服务或模型",
  404: "接口或模型不存在：确认 URL 是否以 /v1 结尾、模型名是否正确",
  405: "请求方法不被支持：通常说明接口地址有误",
  408: "服务端响应超时：网络不稳定，请重试",
  429: "请求过于频繁或额度已用完：请稍后重试或检查账户余额",
  500: "服务端内部错误：通常是对方故障，可稍后重试",
  502: "网关错误：服务端故障，稍后重试",
  503: "服务暂不可用：稍后重试",
  504: "网关超时：服务端响应慢，稍后重试"
};

export interface ClassifiedError {
  code: string;
  message: string;
  status?: number;
  suggestion?: string;
}

/**
 * 把任意异常归类为 { code, message, status?, suggestion? }。
 * 识别：HTTP 状态码、DNS 解析失败、连接拒绝、超时、未配置等。
 */
export function classifyAiError(e: unknown): ClassifiedError {
  // 取深层 cause（Node fetch 网络错误常包在 cause 里）
  const err = e as { message?: string; status?: number; code?: string; cause?: { message?: string; code?: string } };
  const cause = err?.cause;
  const msg = cause?.message || err?.message || String(e);
  const hay = `${msg} ${cause?.code || ""}`.toLowerCase();

  // 1. 已分类的 AiError
  if (e instanceof AiError) {
    if (e.status) {
      return { code: e.code, message: e.message, status: e.status, suggestion: HTTP_HINTS[e.status] };
    }
    if (e.code === "ai_network") {
      // 网络类：继续按消息细分
      const net = classifyNetwork(hay, e.message);
      return net;
    }
    // ai_not_configured / ai_no_key / ai_empty / ai_parse ...
    const suggestion =
      e.code === "ai_no_key" ? "到「智能服务设置」填写 API Key 并保存"
      : e.code === "ai_not_configured" ? "到「智能服务设置」填写 API URL 与模型"
      : e.code === "ai_empty" ? "服务返回了空内容，可能是模型不支持该请求，换一个模型试试"
      : e.code === "ai_parse" ? "服务返回内容不是合法 JSON，检查模型是否支持指定格式"
      : undefined;
    return { code: e.code, message: e.message, suggestion };
  }

  // 2. 网络层：按消息特征细分
  return classifyNetwork(hay, msg);
}

function classifyNetwork(hay: string, rawMsg: string): ClassifiedError {
  if (/timeout|timed\s*out|abort/i.test(hay)) {
    return { code: "ai_timeout", message: `请求超时：${rawMsg}`, suggestion: "网络不稳定或服务端响应慢，请稍后重试" };
  }
  if (/enotfound|getaddrinfo|nxdomain|eai_again|failed to fetch|dns/i.test(hay)) {
    return { code: "ai_dns", message: `无法解析域名（地址错误或需网络代理）：${rawMsg}`, suggestion: "检查 API URL 是否正确、电脑能否访问该域名（可能需要代理）" };
  }
  if (/econnrefused|ecunnreset|connection refused|reset by peer/i.test(hay)) {
    return { code: "ai_connect", message: `连接被拒绝/中断：${rawMsg}`, suggestion: "检查服务地址与端口是否正确，本地服务（如 Ollama）是否已启动" };
  }
  if (/ecert|self[- ]signed|certificate/i.test(hay)) {
    return { code: "ai_tls", message: `TLS 证书校验失败：${rawMsg}`, suggestion: "若服务使用自签名证书，请检查地址是否写对，或改用 HTTPS 有效证书" };
  }
  return { code: "ai_network", message: `网络错误：${rawMsg}`, suggestion: "检查网络连接后重试" };
}

// ---------------------------------------------------------------------------
// URL 归一化
// ---------------------------------------------------------------------------

/**
 * 归一化 Base URL：
 *  - 去首尾空白、去尾部多余斜杠；
 *  - 保留已有 /v1（或 /v2 …），绝不重复追加；
 *  - 否则追加 /v1。
 * 例如："" → ""；"https://x" → "https://x/v1"；"https://x/v1/" → "https://x/v1"。
 */
export function normalizeBaseUrl(input: string): string {
  const s = (input || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  const last = s.split("/").filter(Boolean).pop() || "";
  if (/^v\d+$/i.test(last)) return s;
  return `${s}/v1`;
}

// ---------------------------------------------------------------------------
// Provider 预设（便捷填充，不做强制绑定）
// ---------------------------------------------------------------------------

export interface AiPreset {
  providerName: string;
  label: string;
  baseUrls: { china: string; intl: string; backup: string };
  textModel: string;
  imageModel: string;
  defaultRegion: keyof AiPreset["baseUrls"];
}

export const AI_PRESETS: Record<string, AiPreset> = {
  agnes: {
    providerName: "Agnes",
    label: "Agnes AI",
    baseUrls: {
      china: "https://api.agnes-ai.cn/v1",
      intl: "https://apihub.agnes-ai.com/v1",
      backup: "https://apihub.agnes-ai.cn/v1"
    },
    textModel: "agnes-2.5-flash",
    imageModel: "agnes-image-2.1-flash",
    defaultRegion: "china"
  }
};

export const AI_PRESET_KEYS = Object.keys(AI_PRESETS);

/** 判断某 provider 名是否命中预设（不区分大小写） */
export function presetOf(provider: string): AiPreset | undefined {
  const p = (provider || "").trim().toLowerCase();
  return AI_PRESETS[p];
}

/**
 * 清洗渲染端传来的配置：
 *  - 只挑选已知字段（杜绝夹带 apiKey / hasKey 等敏感字段）；
 *  - baseUrl 统一 normalize（保存即归一化，杜绝 /v1 重复）；
 *  - 结果为纯普通对象，天然 Structured-Clone 安全。
 */
export function sanitizeAiConfig(input: unknown): AiProviderConfig {
  const s = (input ?? {}) as Record<string, unknown>;
  const adv = (s.advanced ?? {}) as Record<string, unknown>;
  const pickStr = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const pickBool = (v: unknown) => v === true;
  const slot = (o: Record<string, unknown>) => ({
    baseUrl: normalizeBaseUrl(pickStr(o.baseUrl)),
    provider: pickStr(o.provider),
    model: pickStr(o.model),
    hasKey: false
  });
  const mode = s.mode === "off" || s.mode === "local" ? (s.mode as "off" | "local") : "cloud";
  return {
    mode,
    provider: pickStr(s.provider) || "openai-compatible",
    baseUrl: normalizeBaseUrl(pickStr(s.baseUrl)),
    textModel: pickStr(s.textModel),
    imageModel: pickStr(s.imageModel),
    dictionary: s.dictionary === "off" ? "off" : "auto",
    advanced: {
      useIndependentText: pickBool(adv.useIndependentText),
      useIndependentImage: pickBool(adv.useIndependentImage),
      useIndependentDictionary: pickBool(adv.useIndependentDictionary),
      text: slot((adv.text ?? {}) as Record<string, unknown>),
      image: slot((adv.image ?? {}) as Record<string, unknown>),
      dictionary: slot((adv.dictionary ?? {}) as Record<string, unknown>)
    },
    hasKey: false
  };
}

// ---------------------------------------------------------------------------
// Provider 抽象
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextProvider {
  name: string;
  complete(messages: ChatMessage[], opts?: { temperature?: number; json?: boolean }): Promise<string>;
}

export interface ImageProvider {
  name: string;
  generate(prompt: string, opts?: { size?: string }): Promise<{ b64?: string; url?: string }>;
}

// ---------- OpenAI 兼容文本 Provider ----------
export class OpenAiCompatibleText implements TextProvider {
  name: string;
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(cfg: { baseUrl: string; apiKey: string; model: string; provider: string }) {
    this.name = cfg.provider || "openai-compatible";
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl);
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async complete(messages: ChatMessage[], opts: { temperature?: number; json?: boolean } = {}): Promise<string> {
    if (!this.baseUrl || !this.model) {
      throw new AiError("ai_not_configured", "AI 服务尚未配置：请先到「智能服务设置」填写 API 地址与模型");
    }
    if (!this.apiKey) {
      throw new AiError("ai_no_key", "未配置 API Key：请到「智能服务设置」填写");
    }
    const url = `${this.baseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.7
    };
    // JSON 输出模式：部分兼容服务不支持 response_format，失败时回退
    if (opts.json) {
      body.response_format = { type: "json_object" };
    }
    let resp: Response | undefined;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      const cause = (e as { cause?: { message?: string } })?.cause;
      const detail = cause?.message || (e as Error).message;
      throw new AiError("ai_network", `网络请求失败：${detail}`);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      // 某些服务不支持 response_format → 去掉重试
      if (opts.json && (resp.status === 400 || resp.status === 404) && /response_format|json/i.test(text.slice(0, 300))) {
        return this.complete(messages, { temperature: opts.temperature, json: false });
      }
      throw new AiError("ai_http", `AI 接口错误 (HTTP ${resp.status})：${text.slice(0, 300)}`, resp.status);
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error) throw new AiError("ai_http", `AI 返回错误：${data.error.message}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new AiError("ai_empty", "AI 返回了空内容");
    }
    return content;
  }
}

// ---------- OpenAI 兼容图片 Provider ----------
export class OpenAiCompatibleImage implements ImageProvider {
  name: string;
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(cfg: { baseUrl: string; apiKey: string; model: string; provider: string }) {
    this.name = cfg.provider || "openai-compatible";
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl);
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async generate(prompt: string, opts: { size?: string } = {}): Promise<{ b64?: string; url?: string }> {
    if (!this.baseUrl || !this.model || !this.apiKey) {
      throw new AiError("ai_not_configured", "图片服务尚未配置：请在「智能服务设置」填写图片 API 与模型");
    }
    const url = `${this.baseUrl}/images/generations`;
    const attempt = (jsonMode: boolean): Promise<{ b64?: string; url?: string }> =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          prompt,
          n: 1,
          size: opts.size || "1024x1024",
          ...(jsonMode ? { response_format: "b64_json" } : {})
        })
      }).then(async (r) => {
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new AiError("ai_http", `图片接口错误 (HTTP ${r.status})：${t.slice(0, 200)}`, r.status);
        }
        return r.json() as Promise<{ data?: Array<{ b64_json?: string; url?: string }> }>;
      }).then((d) => {
        const item = d.data?.[0];
        if (!item) throw new AiError("ai_empty", "图片服务返回空数据");
        if (item.b64_json) return { b64: item.b64_json };
        if (item.url) return { url: item.url };
        throw new AiError("ai_empty", "图片服务未返回图片数据");
      });

    try {
      return await attempt(true);
    } catch (e) {
      // b64 模式不支持（如部分模型）→ 改用 url 模式
      if (e instanceof AiError && e.code === "ai_http") {
        return attempt(false);
      }
      throw e;
    }
  }
}

// ---------- 本地 API（Ollama 等 OpenAI 兼容 /v1） ----------
export function isLocalUrl(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(baseUrl || "");
}

// ---------------------------------------------------------------------------
// 服务真实测试（结构化结果，Structured-Clone 安全）
// ---------------------------------------------------------------------------

export interface ServiceTestResult {
  service: "text" | "image";
  success: boolean;
  code: string;
  message: string;
  status?: number;
  endpoint?: string;
  model?: string;
  durationMs: number;
  suggestion?: string;
}

const TEST_USER_PROMPT = "Reply with exactly: OK";

/** 真实调用文本接口：POST {baseUrl}/chat/completions（n=1，最小请求） */
export async function testTextService(cfg: {
  baseUrl: string; apiKey: string; model: string; provider: string;
}): Promise<ServiceTestResult> {
  const t0 = Date.now();
  const endpoint = `${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`;
  const base: ServiceTestResult = {
    service: "text", success: false, code: "unknown", message: "", endpoint, model: cfg.model, durationMs: 0
  };
  if (!cfg.baseUrl || !cfg.model) {
    return { ...base, code: "ai_not_configured", message: "文本服务未配置：请填写 API URL 与文本模型", durationMs: Date.now() - t0, suggestion: "到「智能服务设置」填写服务商、API URL 与文本模型后保存" };
  }
  if (!cfg.apiKey) {
    return { ...base, code: "ai_no_key", message: "未配置 API Key（文本服务）", durationMs: Date.now() - t0, suggestion: "到「智能服务设置」填写 API Key 并保存" };
  }
  try {
    const provider = new OpenAiCompatibleText(cfg);
    const out = await provider.complete(
      [
        { role: "system", content: "You are a connection test helper." },
        { role: "user", content: TEST_USER_PROMPT }
      ],
      { temperature: 0, json: false }
    );
    return {
      ...base, success: true, code: "ok",
      message: `连接成功，模型回复：${out.slice(0, 40)}`,
      durationMs: Date.now() - t0
    };
  } catch (e) {
    const c = classifyAiError(e);
    return { ...base, code: c.code, message: c.message, status: c.status, suggestion: c.suggestion, durationMs: Date.now() - t0 };
  }
}

/**
 * 真实调用图片接口：POST {baseUrl}/images/generations（n=1）。
 * 会真实生成 1 张图（可能产生少量费用），因此能给出真实的 HTTP 状态/耗时/模型信息。
 */
export async function testImageService(cfg: {
  baseUrl: string; apiKey: string; model: string; provider: string;
}): Promise<ServiceTestResult> {
  const t0 = Date.now();
  const endpoint = `${normalizeBaseUrl(cfg.baseUrl)}/images/generations`;
  const base: ServiceTestResult = {
    service: "image", success: false, code: "unknown", message: "", endpoint, model: cfg.model, durationMs: 0
  };
  if (!cfg.baseUrl || !cfg.model) {
    return { ...base, code: "ai_not_configured", message: "图片服务未配置：请填写 API URL 与图片模型", durationMs: Date.now() - t0, suggestion: "到「智能服务设置」填写图片服务（可独立配置，或留空复用文本服务）" };
  }
  if (!cfg.apiKey) {
    return { ...base, code: "ai_no_key", message: "未配置 API Key（图片服务）", durationMs: Date.now() - t0, suggestion: "填写图片服务 Key 并保存（可复用主 Key）" };
  }
  try {
    const provider = new OpenAiCompatibleImage(cfg);
    await provider.generate("A small green apple on a clean white desk, classroom illustration", { size: "1024x1024" });
    return {
      ...base, success: true, code: "ok",
      message: "图片生成成功（本次真实调用生成 1 张，可能产生少量费用）",
      durationMs: Date.now() - t0
    };
  } catch (e) {
    const c = classifyAiError(e);
    return { ...base, code: c.code, message: c.message, status: c.status, suggestion: c.suggestion, durationMs: Date.now() - t0 };
  }
}

// ---------------------------------------------------------------------------
// 工厂：根据 App 配置构造 Provider
// ---------------------------------------------------------------------------

export interface ResolvedAiCfg {
  text: { baseUrl: string; apiKey: string; model: string; provider: string; enabled: boolean };
  image: { baseUrl: string; apiKey: string; model: string; provider: string; enabled: boolean };
}

export function resolveAiCfg(
  config: AiProviderConfig,
  secrets: { main: string; text: string; image: string; dictionary: string }
): ResolvedAiCfg {
  const c = config;
  const base = {
    baseUrl: normalizeBaseUrl(c.baseUrl),
    apiKey: secrets.main,
    provider: c.provider
  };
  const enabled = c.mode !== "off";

  // 独立 Text：使用独立 URL/Key（Key 缺省时回落主 Key）；否则用主配置
  const textCfg = c.advanced.useIndependentText && c.advanced.text.baseUrl
    ? { baseUrl: normalizeBaseUrl(c.advanced.text.baseUrl), apiKey: secrets.text || secrets.main, provider: c.advanced.text.provider || c.provider, model: c.advanced.text.model || c.textModel }
    : { ...base, model: c.textModel };

  // 独立 Image：URL 缺省回落文本/主 URL；Key 缺省回落主 Key
  const imageCfg = c.advanced.useIndependentImage && c.advanced.image.baseUrl
    ? { baseUrl: normalizeBaseUrl(c.advanced.image.baseUrl), apiKey: secrets.image || secrets.main, provider: c.advanced.image.provider || c.provider, model: c.advanced.image.model || c.imageModel }
    : { ...base, model: c.imageModel };

  return {
    text: { ...textCfg, enabled: enabled && !!textCfg.model },
    image: { ...imageCfg, enabled: enabled && !!imageCfg.model }
  };
}

/** 主进程统一的“读取配置 + 读取密钥 → 解析服务配置”入口（异步密钥） */
export async function collectResolvedCfg(db: Db): Promise<ResolvedAiCfg> {
  const config = readAiConfig(db.db);
  const secrets = {
    main: await getSecret(db, "main"),
    text: await getSecret(db, "text"),
    image: await getSecret(db, "image"),
    dictionary: await getSecret(db, "dictionary")
  };
  return resolveAiCfg(config, secrets);
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/** 从模型响应中稳健解析 JSON（去除 markdown 代码围栏） */
export function parseModelJson<T>(content: string): T {
  let s = (content || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    s = s.slice(start, end + 1);
  }
  try {
    return JSON.parse(s) as T;
  } catch (e) {
    throw new AiError("ai_parse", `AI 返回内容不是合法 JSON：${content.slice(0, 200)}`);
  }
}
