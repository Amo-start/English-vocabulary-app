// Store 辅助：占位图片
// V4.1: 默认 sourceType 改为 "api"（AI 优先），"builtin" 降级为 legacy_builtin 离线兜底
import type { ItemImage } from "../shared/types";

export function newImagePlaceholder(): ItemImage {
  return {
    localPath: "",
    sourceType: "api",
    sourceUrl: "",
    description: "",
    status: "ok",
    locked: false,
    history: []
  };
}
