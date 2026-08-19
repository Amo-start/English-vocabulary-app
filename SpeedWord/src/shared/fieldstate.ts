// 字段人工状态管理：auto / edited / locked
// 核心原则：locked 与 edited 字段不得被自动生成覆盖。
import type { FieldState, FieldStateValue } from "./types";

export const AUTO: FieldStateValue = "auto";
export const EDITED: FieldStateValue = "edited";
export const LOCKED: FieldStateValue = "locked";

export const EMPTY_FIELD_STATE: FieldState = {
  phonetic: "auto",
  meaningZh: "auto",
  definitionEn: "auto",
  example: "auto",
  image: "auto",
  audio: "auto"
};

export type EditableField = keyof FieldState;

export const EDITABLE_FIELDS: EditableField[] = [
  "phonetic", "meaningZh", "definitionEn", "example", "image", "audio"
];

export function cloneFieldState(fs: FieldState): FieldState {
  return { ...EMPTY_FIELD_STATE, ...(fs || {}) };
}

/** 该字段是否允许被自动生成覆盖 */
export function canAutoOverwrite(fs: FieldState, field: EditableField): boolean {
  return (fs?.[field] || "auto") === "auto";
}

/** 教师手动编辑字段 → 标记 edited */
export function markEdited(fs: FieldState, field: EditableField): FieldState {
  const next = cloneFieldState(fs);
  if (next[field] !== "locked") next[field] = "edited";
  return next;
}

/** 教师锁定字段 */
export function lockField(fs: FieldState, field: EditableField): FieldState {
  const next = cloneFieldState(fs);
  next[field] = "locked";
  return next;
}

/** 解锁字段 */
export function unlockField(fs: FieldState, field: EditableField): FieldState {
  const next = cloneFieldState(fs);
  next[field] = "auto";
  return next;
}

/**
 * 合并自动生成结果，遵守人工优先级。
 * 返回 { item, overwritten: string[] } —— overwritten 记录实际被覆盖的字段。
 */
export function mergeAutoResult<T>(
  current: T,
  incoming: Partial<T>,
  fields: EditableField[],
  getField: (item: T) => FieldState,
  setField: (item: T, fs: FieldState) => T
): { item: T; overwritten: EditableField[] } {
  const fs = cloneFieldState(getField(current));
  const item = { ...current } as T;
  const overwritten: EditableField[] = [];
  for (const f of fields) {
    const key = f as keyof T;
    const val = incoming[key];
    if (val === undefined || val === null) continue;
    const empty = (typeof val === "string" && !String(val).trim()) ||
      (typeof val === "object" && val !== null && (val as { localPath?: string; status?: string }).localPath === "");
    if (empty) continue;
    if (canAutoOverwrite(fs, f)) {
      (item as unknown as Record<string, unknown>)[String(key)] = val;
      overwritten.push(f);
    } else if (fs[f] === "locked") {
      // 锁定字段：绝不覆盖
    } else if (fs[f] === "edited") {
      // 已人工编辑字段：只有 incoming 为空才允许回填
    }
  }
  return { item: setField(item, fs), overwritten };
}

/** 字段状态中文标签 */
export function fieldStateLabel(s: FieldStateValue): string {
  return s === "locked" ? "锁定" : s === "edited" ? "已改" : "自动";
}
