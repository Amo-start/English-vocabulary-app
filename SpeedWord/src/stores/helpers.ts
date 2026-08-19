// Store 辅助：占位图片
import type { ItemImage } from "../shared/types";

export function newImagePlaceholder(): ItemImage {
  return {
    localPath: "",
    sourceType: "builtin",
    sourceUrl: "",
    description: "",
    status: "ok",
    locked: false,
    history: []
  };
}
