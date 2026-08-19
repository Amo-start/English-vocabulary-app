// 词包与词条 Store
import { defineStore } from "pinia";
import { ref } from "vue";
import type { ContentItem, WordPack } from "../shared/types";
import { uid, now } from "../shared/uuid";
import { EMPTY_FIELD_STATE } from "../shared/fieldstate";
import { detectContentType } from "../shared/type-detect";
import { newImagePlaceholder } from "./helpers";

export const usePacksStore = defineStore("packs", () => {
  const packs = ref<WordPack[]>([]);
  const items = ref<ContentItem[]>([]);
  const currentPackId = ref<string>("");
  const loading = ref(false);

  async function loadPacks(): Promise<void> {
    loading.value = true;
    try {
      packs.value = await window.api.packsList();
    } finally {
      loading.value = false;
    }
  }

  async function loadItems(packId: string): Promise<ContentItem[]> {
    currentPackId.value = packId;
    items.value = await window.api.itemsList(packId);
    return items.value;
  }

  async function createPack(name: string, description = ""): Promise<WordPack> {
    const p = await window.api.packCreate(name, description);
    await loadPacks();
    return p;
  }

  async function updatePack(id: string, name: string, description = ""): Promise<void> {
    await window.api.packUpdate(id, name, description);
    await loadPacks();
  }

  async function deletePack(id: string): Promise<void> {
    await window.api.packDelete(id);
    await loadPacks();
  }

  function getPack(id: string): WordPack | undefined {
    return packs.value.find((p) => p.id === id);
  }

  /** 新建空词条（草稿，保存时落库） */
  function newItem(packId: string, text = ""): ContentItem {
    const t = now();
    return {
      id: uid("item"),
      packId,
      sort: items.value.length,
      type: detectContentType(text || "word"),
      text: text || "",
      phonetic: "",
      partOfSpeech: "",
      meaningZh: "",
      definitionEn: "",
      example: "",
      audio: { source: "none", status: "none" },
      image: newImagePlaceholder(),
      aiMeta: { generatedBy: "none", generatedAt: t },
      fieldState: { ...EMPTY_FIELD_STATE },
      verified: false,
      locked: false,
      createdAt: t,
      updatedAt: t
    };
  }

  async function saveItem(item: ContentItem): Promise<ContentItem> {
    item.updatedAt = now();
    const saved = await window.api.itemSave(item);
    const idx = items.value.findIndex((i) => i.id === item.id);
    if (idx >= 0) items.value[idx] = saved || item;
    else items.value.push(saved || item);
    return saved || item;
  }

  async function removeItem(id: string): Promise<void> {
    await window.api.itemDelete(id);
    items.value = items.value.filter((i) => i.id !== id);
  }

  async function addItems(packId: string, newItems: ContentItem[]): Promise<void> {
    const existing = items.value;
    const base = existing.length;
    const prepared = newItems.map((it, i) => ({
      ...it,
      id: uid("item"),
      packId,
      sort: base + i,
      createdAt: now(),
      updatedAt: now()
    }));
    items.value = [...existing, ...prepared];
    await window.api.itemsReplaceAll(packId, items.value);
  }

  return {
    packs, items, currentPackId, loading,
    loadPacks, loadItems, createPack, updatePack, deletePack, getPack,
    newItem, saveItem, removeItem, addItems
  };
});
