// API Key 安全存储：Electron safeStorage（Windows 基于 DPAPI）加密。
// 数据库中只存密文（base64），渲染进程永不接触明文 Key。
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

/** 保存明文 Key（内部立即加密） */
export function setSecret(db: Db, slot: KeySlot, plaintext: string): void {
  const val = (plaintext || "").trim();
  if (!val) {
    aiSettingsSet(db.db, SLOT_KEY[slot], "");
    return;
  }
  let encrypted: string;
  if (encryptionAvailable()) {
    encrypted = safeStorage.encryptString(val).toString("base64");
  } else {
    // 兜底：不可用加密时仅做弱混淆，并标记，避免崩溃（Windows 下几乎不会走到）
    encrypted = "plain:" + Buffer.from(val, "utf8").toString("base64");
  }
  aiSettingsSet(db.db, SLOT_KEY[slot], encrypted);
}

/** 读取明文 Key（仅供主进程内 AI 调用使用） */
export function getSecret(db: Db, slot: KeySlot): string {
  const raw = aiSettingsGet(db.db, SLOT_KEY[slot]);
  if (!raw) return "";
  try {
    if (raw.startsWith("plain:")) {
      return Buffer.from(raw.slice(6), "base64").toString("utf8");
    }
    if (encryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(raw, "base64"));
    }
    return "";
  } catch {
    return "";
  }
}

/** 是否已配置密钥（供渲染端显示“已配置”，不返回明文） */
export function hasSecret(db: Db, slot: KeySlot): boolean {
  const raw = aiSettingsGet(db.db, SLOT_KEY[slot]);
  return !!raw;
}
