// AI Provider 统一接口 + OpenAI 兼容实现 + Ollama 本地兼容。
// 教师配置自己的 API URL / Key / Model；主进程持有 Key 并完成所有请求。
import { httpGet } from "./util";
import type { AiProviderConfig } from "../src/shared/types";

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
    this.baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
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
      throw new AiError("ai_network", `网络请求失败：${(e as Error).message}`);
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
    this.baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
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

// ---------- 测试连接 ----------
export async function testConnection(cfg: {
  baseUrl: string; apiKey: string; model: string; provider: string;
}): Promise<{ ok: boolean; message: string; model?: string }> {
  try {
    const provider = new OpenAiCompatibleText(cfg);
    const out = await provider.complete(
      [{ role: "system", content: "You are a connection test helper." }, { role: "user", content: "Reply with exactly: OK" }],
      { temperature: 0, json: false }
    );
    return { ok: true, message: `连接成功（模型 ${cfg.model}）：${out.slice(0, 40)}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function testImageConnection(cfg: {
  baseUrl: string; apiKey: string; model: string; provider: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const provider = new OpenAiCompatibleImage(cfg);
    // 不真实生成图片，仅探测接口可用性（GET /models）
    const ok = await httpGet(`${(cfg.baseUrl || "").replace(/\/+$/, "")}/models`, 10000).catch(() => null);
    if (!ok) {
      return { ok: false, message: "图片服务地址不可达（不影响文本服务）" };
    }
    return { ok: true, message: "图片服务已配置（生成将在使用时调用）" };
  } catch {
    return { ok: false, message: "图片服务地址不可达（不影响文本服务）" };
  }
}

// ---------- 工厂：根据 App 配置构造 Provider ----------
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
    baseUrl: c.baseUrl,
    apiKey: secrets.main,
    provider: c.provider
  };
  const enabled = c.mode !== "off";

  const textCfg = c.advanced.useIndependentText && c.advanced.text.baseUrl
    ? { baseUrl: c.advanced.text.baseUrl, apiKey: secrets.text || secrets.main, provider: c.advanced.text.provider || c.provider, model: c.advanced.text.model || c.textModel }
    : { ...base, model: c.textModel };

  const imageCfg = c.advanced.useIndependentImage && c.advanced.image.baseUrl
    ? { baseUrl: c.advanced.image.baseUrl, apiKey: secrets.image || secrets.main, provider: c.advanced.image.provider || c.provider, model: c.advanced.image.model || c.imageModel }
    : { ...base, model: c.imageModel };

  return {
    text: { ...textCfg, enabled: enabled && !!textCfg.model },
    image: { ...imageCfg, enabled: enabled && !!imageCfg.model }
  };
}

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
