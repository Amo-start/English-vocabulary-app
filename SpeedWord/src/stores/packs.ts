// 词包与词条 Store
import { defineStore } from "pinia";
import { ref } from "vue";
import type { ContentItem, WordPack } from "../shared/types";
import { uid, now } from "../shared/uuid";
import { EMPTY_FIELD_STATE } from "../shared/fieldstate";
import { detectContentType } from "../shared/type-detect";
import { newImagePlaceholder } from "./helpers";
import type { DraftSavePayload } from "../shared/draft-types";

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
    // V4.3: 转 plain DTO，避免 Vue reactive proxy 触发 DataCloneError
    const plain: ContentItem = {
      id: item.id, packId: item.packId, sort: item.sort, type: item.type,
      text: item.text, phonetic: item.phonetic, partOfSpeech: item.partOfSpeech,
      meaningZh: item.meaningZh, definitionEn: item.definitionEn, example: item.example,
      audio: { ...item.audio },
      image: { ...item.image, history: item.image.history || [] },
      aiMeta: { ...item.aiMeta },
      fieldState: { ...item.fieldState },
      verified: item.verified, locked: item.locked,
      createdAt: item.createdAt, updatedAt: item.updatedAt
    };
    const saved = await window.api.itemSave(plain);
    const idx = items.value.findIndex((i) => i.id === item.id);
    if (idx >= 0) items.value[idx] = saved || item;
    else items.value.push(saved || item);
    return saved || item;
  }

  async function removeItem(id: string): Promise<void> {
    await window.api.itemDelete(id);
    items.value = items.value.filter((i) => i.id !== id);
  }

  /**
   * V4.1: 将 Draft 词条批量保存到词包。
   * 前端发送 Plain DTO（不含 Vue Proxy），主进程生成正式 UUID。
   * 返回 mapping：draftId → persistentId，用于前端更新本地状态。
   */
  async function addDraftItems(
    packId: string,
    drafts: Array<{ draftId: string } & Omit<DraftSavePayload, "draftId">>
  ): Promise<Record<string, string>> {
    const res = await window.api.itemsAddDrafts(packId, drafts as DraftSavePayload[]);
    // 校验映射数量
    if (res.persistentIds.length !== drafts.length) {
      throw new Error(`保存数量不匹配：期望 ${drafts.length}，实际 ${res.persistentIds.length}`);
    }
    return res.mapping;
  }

  /** 向后兼容：直接保存 ContentItem 数组（用于词条编辑器等场景） */
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
    // 合并后本地数组先更新（乐观 UI），再落库
    items.value = [...existing, ...prepared];
    // V4.3: 转 plain DTO 数组，避免 Vue reactive proxy 触发 DataCloneError
    const plainItems: ContentItem[] = items.value.map((it) => ({
      id: it.id, packId: it.packId, sort: it.sort, type: it.type,
      text: it.text, phonetic: it.phonetic, partOfSpeech: it.partOfSpeech,
      meaningZh: it.meaningZh, definitionEn: it.definitionEn, example: it.example,
      audio: { ...it.audio },
      image: { ...it.image, history: it.image.history || [] },
      aiMeta: { ...it.aiMeta },
      fieldState: { ...it.fieldState },
      verified: it.verified, locked: it.locked,
      createdAt: it.createdAt, updatedAt: it.updatedAt
    }));
    const res = await window.api.itemsReplaceAll(packId, plainItems);
    if (res && res.count !== undefined && res.count !== items.value.length) {
      throw new Error(`保存数量不匹配：期望 ${items.value.length}，实际 ${res.count}`);
    }
  }

  return {
    packs, items, currentPackId, loading,
    loadPacks, loadItems, createPack, updatePack, deletePack, getPack,
    newItem, saveItem, removeItem, addItems, addDraftItems
  };
});
