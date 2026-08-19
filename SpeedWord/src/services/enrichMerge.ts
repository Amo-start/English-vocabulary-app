// 把智能补全结果合并进已有词条，严格遵循 fieldState：
// locked / edited 字段绝不覆盖；auto 字段才回填。
import type { ContentItem } from "../shared/types";
import { cloneFieldState } from "../shared/fieldstate";

export function mergeEnrichIntoItem(current: ContentItem, fresh: ContentItem): ContentItem {
  const fs = cloneFieldState(current.fieldState);
  const next: ContentItem = { ...current };
  const apply = <K extends keyof ContentItem>(field: keyof ContentItem["fieldState"], key: K, allowEmpty: boolean) => {
    if (fs[field] !== "auto") return; // locked/edited 不覆盖
    const v = fresh[key];
    if (v === undefined || v === null) return;
    const isEmpty = typeof v === "string" ? !String(v).trim() : false;
    if (isEmpty && !allowEmpty) return;
    (next[key] as unknown) = v;
  };

  apply("phonetic", "phonetic", true);
  apply("meaningZh", "meaningZh", false);
  apply("definitionEn", "definitionEn", false);
  apply("example", "example", false);
  apply("image", "image", true);
  apply("audio", "audio", true);

  // 补充元数据
  if (fresh.aiMeta?.memoryHint && !next.aiMeta?.memoryHint) {
    next.aiMeta = { ...next.aiMeta, memoryHint: fresh.aiMeta.memoryHint };
  }
  if (fresh.aiMeta?.imageDescription) {
    next.aiMeta = { ...next.aiMeta, imageDescription: fresh.aiMeta.imageDescription };
  }
  if (fresh.partOfSpeech && !next.partOfSpeech) next.partOfSpeech = fresh.partOfSpeech;
  next.verified = !!current.verified;
  next.locked = !!current.locked;
  next.updatedAt = Date.now();
  return next;
}
