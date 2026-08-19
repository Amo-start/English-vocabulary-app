import { describe, it, expect } from "vitest";
import type { FieldState } from "../src/shared/types";
import {
  EMPTY_FIELD_STATE, canAutoOverwrite, markEdited, lockField, unlockField, mergeAutoResult, fieldStateLabel,
  type EditableField
} from "../src/shared/fieldstate";

describe("字段人工状态", () => {
  it("初始全为 auto，允许自动覆盖", () => {
    for (const k of Object.keys(EMPTY_FIELD_STATE)) {
      expect(EMPTY_FIELD_STATE[k as keyof typeof EMPTY_FIELD_STATE]).toBe("auto");
    }
    expect(canAutoOverwrite(EMPTY_FIELD_STATE, "meaningZh")).toBe(true);
  });

  it("markEdited 标记为 edited（locked 不被降级）", () => {
    const fs = markEdited(EMPTY_FIELD_STATE, "meaningZh");
    expect(fs.meaningZh).toBe("edited");
    expect(canAutoOverwrite(fs, "meaningZh")).toBe(false);
    // locked 字段不会被 markEdited 覆盖
    const locked = lockField(EMPTY_FIELD_STATE, "example");
    const after = markEdited(locked, "example");
    expect(after.example).toBe("locked");
  });

  it("lock / unlock", () => {
    const l = lockField(EMPTY_FIELD_STATE, "image");
    expect(l.image).toBe("locked");
    expect(canAutoOverwrite(l, "image")).toBe(false);
    expect(unlockField(l, "image").image).toBe("auto");
  });

  it("fieldStateLabel 中文", () => {
    expect(fieldStateLabel("auto")).toBe("自动");
    expect(fieldStateLabel("edited")).toBe("已改");
    expect(fieldStateLabel("locked")).toBe("锁定");
  });
});

describe("mergeAutoResult：locked/edited 绝不覆盖（验收点 #6）", () => {
  const fields: EditableField[] = ["phonetic", "meaningZh", "definitionEn", "example", "image"];
  const getField = (o: { fs: FieldState; meaningZh: string }) => o.fs;
  const setField = (o: { fs: FieldState; meaningZh: string }, fs: FieldState) => ({ ...o, fs });

  it("auto 字段回填", () => {
    const cur = { fs: { ...EMPTY_FIELD_STATE }, meaningZh: "" };
    const inc = { meaningZh: "苹果" };
    const { item, overwritten } = mergeAutoResult(cur, inc, fields, getField, setField);
    expect(item.meaningZh).toBe("苹果");
    expect(overwritten).toContain("meaningZh");
  });

  it("locked 字段绝不覆盖", () => {
    const fs = lockField(EMPTY_FIELD_STATE, "meaningZh");
    const cur = { fs, meaningZh: "我手改过的解释" };
    const inc = { meaningZh: "AI 生成的解释" };
    const { item, overwritten } = mergeAutoResult(cur, inc, fields, getField, setField);
    expect(item.meaningZh).toBe("我手改过的解释");
    expect(overwritten).not.toContain("meaningZh");
  });

  it("edited 字段不覆盖", () => {
    const fs = markEdited(EMPTY_FIELD_STATE, "meaningZh");
    const cur = { fs, meaningZh: "教师手改" };
    const { item, overwritten } = mergeAutoResult(cur, { meaningZh: "自动" }, fields, getField, setField);
    expect(item.meaningZh).toBe("教师手改");
    expect(overwritten).not.toContain("meaningZh");
  });

  it("空值 incoming 不回填空串", () => {
    const cur = { fs: { ...EMPTY_FIELD_STATE }, meaningZh: "保留" };
    const { item } = mergeAutoResult(cur, { meaningZh: "  " }, fields, getField, setField);
    expect(item.meaningZh).toBe("保留");
  });
});
