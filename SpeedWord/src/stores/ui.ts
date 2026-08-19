// 全局 UI 状态：视图切换、Toast、确认框（Pinia，不使用 vue-router，桌面单窗口场景更简单）
import { defineStore } from "pinia";
import { ref } from "vue";
import { uid } from "../shared/uuid";

export type ViewName =
  | "home"
  | "packs"
  | "smart-create"
  | "item-editor"
  | "media"
  | "game-center"
  | "review-pool"
  | "settings"
  | "backup"
  | "classroom";

export interface RouteParams {
  packId?: string;
  itemId?: string;
  mode?: string;
  [key: string]: unknown;
}

interface ToastItem {
  id: string;
  type: "info" | "success" | "error" | "warn";
  message: string;
  timeout: number;
}

interface ConfirmOpts {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export const useUiStore = defineStore("ui", () => {
  const view = ref<ViewName>("home");
  const params = ref<RouteParams>({});
  const toasts = ref<ToastItem[]>([]);
  const confirmState = ref<{ opts: ConfirmOpts | null; resolve: ((v: boolean) => void) | null }>({ opts: null, resolve: null });

  function go(name: ViewName, p: RouteParams = {}): void {
    params.value = p;
    view.value = name;
  }

  function toast(message: string, type: ToastItem["type"] = "info", timeout = 2600): void {
    const id = uid("t");
    toasts.value.push({ id, type, message, timeout });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, timeout);
  }

  function confirm(opts: ConfirmOpts): Promise<boolean> {
    return new Promise((resolve) => {
      confirmState.value = { opts, resolve };
    });
  }

  function resolveConfirm(v: boolean): void {
    confirmState.value.resolve?.(v);
    confirmState.value = { opts: null, resolve: null };
  }

  return { view, params, toasts, confirmState, go, toast, confirm, resolveConfirm };
});
