// API Key 安全存储：Electron safeStorage（Windows 基于 DPAPI）加密。
// 数据库中只存密文（base64 字符串），渲染进程永不接触明文 Key。
//
// 说明：Electron 31 的 safeStorage 仅提供同步 encryptString / decryptString，
// 这里用 Promise 包装成统一异步接口（encryptStringAsync / decryptStringAsync），
// 便于主进程编排，并处理“需要重加密”（shouldReEncrypt）：
//   - 旧版本存的无前缀密文、或不可加密环境落地的 plain: 兜底，在可加密时自动升级重加密。
import { safeStorage } from "electron";
import type { Db } from "./db";
import { aiSettingsGet, aiSettingsSet } from "./db";

export type KeySlot = "main" | "text" | "image" | "dictionary";

const SLOT_KEY: Record<KeySlot, string> = {
  main: "enc:apiKey",
  text: "enc:apiKeyText",
  image: "enc:apiKeyImage",
  dictionary: "enc:apiKeyDictionary"
};

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export interface EncryptResult {
  encrypted: string;
  /** 是否真正走了系统级加密（false 表示只做了弱混淆兜底） */
  available: boolean;
}

/** 异步加密：密文存为 base64 字符串（不存 Buffer）。空值返回空串。 */
export async function encryptStringAsync(plaintext: string): Promise<EncryptResult> {
  const val = (plaintext || "").trim();
  if (!val) return { encrypted: "", available: false };
  if (encryptionAvailable()) {
    const buf = await Promise.resolve().then(() => safeStorage.encryptString(val));
    return { encrypted: "enc:" + buf.toString("base64"), available: true };
  }
  // 兜底：加密不可用时仅做弱混淆并标记（Windows 下几乎不会走到）
  return { encrypted: "plain:" + Buffer.from(val, "utf8").toString("base64"), available: false };
}

export interface DecryptResult {
  plaintext: string;
  /** 是否需要重加密（旧格式 / 兜底格式在可加密环境中应升级） */
  shouldReEncrypt: boolean;
}

/** 异步解密：兼容 enc: 前缀与旧版无前缀两种密文，以及 plain: 兜底。 */
export async function decryptStringAsync(encrypted: string): Promise<DecryptResult> {
  const raw = (encrypted || "").trim();
  if (!raw) return { plaintext: "", shouldReEncrypt: false };
  try {
    if (raw.startsWith("plain:")) {
      const plaintext = Buffer.from(raw.slice(6), "base64").toString("utf8");
      // 兜底明文：只要系统加密可用，就应升级为真正加密
      return { plaintext, shouldReEncrypt: encryptionAvailable() };
    }
    if (encryptionAvailable()) {
      const b64 = raw.replace(/^enc:/, "");
      const plaintext = await Promise.resolve().then(() => safeStorage.decryptString(Buffer.from(b64, "base64")));
      return { plaintext, shouldReEncrypt: !raw.startsWith("enc:") };
    }
    return { plaintext: "", shouldReEncrypt: false };
  } catch {
    return { plaintext: "", shouldReEncrypt: false };
  }
}

/** 保存明文 Key（主进程内调用；立即加密，只写密文） */
export async function setSecret(db: Db, slot: KeySlot, plaintext: string): Promise<void> {
  const { encrypted } = await encryptStringAsync(plaintext);
  aiSettingsSet(db.db, SLOT_KEY[slot], encrypted);
}

/** 读取明文 Key（仅供主进程内 AI 调用使用；必要时自动重加密升级） */
export async function getSecret(db: Db, slot: KeySlot): Promise<string> {
  const raw = aiSettingsGet(db.db, SLOT_KEY[slot]);
  const { plaintext, shouldReEncrypt } = await decryptStringAsync(raw);
  if (shouldReEncrypt && plaintext && raw) {
    // 自动升级：旧格式密文/兜底 → 重新加密存储（内存立即生效，随下次 db.save() 落盘）
    const { encrypted } = await encryptStringAsync(plaintext);
    aiSettingsSet(db.db, SLOT_KEY[slot], encrypted);
  }
  return plaintext;
}

/** 是否已配置密钥（供渲染端显示“已配置”，不返回明文） */
export function hasSecret(db: Db, slot: KeySlot): boolean {
  const raw = aiSettingsGet(db.db, SLOT_KEY[slot]);
  return !!raw;
}
