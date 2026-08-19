// 复习池 Store：课堂「重点复习」进入本地复习池
import { defineStore } from "pinia";
import { ref } from "vue";
import type { ReviewEntry } from "../shared/types";
import { uid, now } from "../shared/uuid";

export const useReviewStore = defineStore("review", () => {
  const entries = ref<ReviewEntry[]>([]);

  async function load(packId?: string): Promise<void> {
    entries.value = await window.api.reviewList(packId);
  }

  async function add(packId: string, itemId: string, reason: string, sourceSession?: string, lastMode?: string): Promise<void> {
    const r: ReviewEntry = {
      id: uid("rv"),
      packId,
      itemId,
      reason,
      sourceSession,
      lastMode,
      createdAt: now()
    };
    await window.api.reviewAdd(r);
    entries.value.push(r);
  }

  async function remove(id: string): Promise<void> {
    await window.api.reviewRemove(id);
    entries.value = entries.value.filter((e) => e.id !== id);
  }

  async function clearPack(packId: string): Promise<void> {
    await window.api.reviewClearPack(packId);
    entries.value = entries.value.filter((e) => e.packId !== packId);
  }

  return { entries, load, add, remove, clearPack };
});
