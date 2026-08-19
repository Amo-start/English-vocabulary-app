<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useUiStore, type ViewName } from "./stores/ui";
import { useSettingsStore } from "./stores/settings";
import { usePacksStore } from "./stores/packs";
import { useReviewStore } from "./stores/review";
import HomeView from "./views/HomeView.vue";
import PacksView from "./views/PacksView.vue";
import SmartCreateView from "./views/SmartCreateView.vue";
import ItemEditorView from "./views/ItemEditorView.vue";
import MediaManagerView from "./views/MediaManagerView.vue";
import GameCenterView from "./views/GameCenterView.vue";
import ReviewPoolView from "./views/ReviewPoolView.vue";
import SettingsView from "./views/SettingsView.vue";
import BackupView from "./views/BackupView.vue";
import ClassroomView from "./views/ClassroomView.vue";

const ui = useUiStore();
const settings = useSettingsStore();
const packs = usePacksStore();
const review = useReviewStore();

const NAV: Array<{ name: ViewName; label: string; emoji: string }> = [
  { name: "home", label: "首页", emoji: "🏠" },
  { name: "packs", label: "我的词包", emoji: "📚" },
  { name: "smart-create", label: "智能创建", emoji: "✨" },
  { name: "media", label: "图片素材", emoji: "🖼️" },
  { name: "game-center", label: "课堂游戏", emoji: "🎮" },
  { name: "review-pool", label: "复习池", emoji: "🔁" },
  { name: "settings", label: "智能服务", emoji: "⚙️" },
  { name: "backup", label: "备份恢复", emoji: "💾" }
];

const isClassroom = computed(() => ui.view === "classroom");

const currentView = computed(() => {
  switch (ui.view) {
    case "home": return HomeView;
    case "packs": return PacksView;
    case "smart-create": return SmartCreateView;
    case "item-editor": return ItemEditorView;
    case "media": return MediaManagerView;
    case "game-center": return GameCenterView;
    case "review-pool": return ReviewPoolView;
    case "settings": return SettingsView;
    case "backup": return BackupView;
    case "classroom": return ClassroomView;
    default: return HomeView;
  }
});

onMounted(async () => {
  await Promise.allSettled([settings.load(), packs.loadPacks(), review.load()]);
});
</script>

<template>
  <div class="app-shell">
    <!-- 侧边栏（全屏课堂时隐藏） -->
    <aside v-if="!isClassroom" class="sidebar">
      <div class="brand">
        <div class="logo">⚡</div>
        <div>
          <h1>极速识词</h1>
          <small>课堂互动版 V4</small>
        </div>
      </div>
      <nav>
        <button
          v-for="n in NAV"
          :key="n.name"
          class="nav-item"
          :class="{ active: ui.view === n.name }"
          @click="ui.go(n.name)"
        >
          <span class="emoji">{{ n.emoji }}</span>{{ n.label }}
        </button>
      </nav>
      <div class="sidebar-foot faint" style="padding: 10px 14px; font-size: 12px">
        {{ settings.isAiAvailable() ? "智能服务已连接" : "智能服务未配置" }}
      </div>
    </aside>

    <!-- 主区域 -->
    <main class="main-area" :class="{ fullbleed: isClassroom }">
      <component :is="currentView" />
    </main>

    <!-- Toast -->
    <div class="toast-wrap">
      <div
        v-for="t in ui.toasts"
        :key="t.id"
        class="toast"
        :class="t.type"
      >{{ t.message }}</div>
    </div>

    <!-- 确认框 -->
    <div v-if="ui.confirmState.opts" class="modal-mask" @click.self="ui.resolveConfirm(false)">
      <div class="modal" style="max-width: 420px">
        <h3 style="margin-bottom: 10px">{{ ui.confirmState.opts.title }}</h3>
        <p class="muted" style="white-space: pre-line">{{ ui.confirmState.opts.message }}</p>
        <div class="row space-between" style="margin-top: 20px">
          <button class="btn btn-ghost" @click="ui.resolveConfirm(false)">
            {{ ui.confirmState.opts.cancelText || "取消" }}
          </button>
          <button
            class="btn"
            :class="ui.confirmState.opts.danger ? 'btn-danger' : 'btn-primary'"
            @click="ui.resolveConfirm(true)"
          >
            {{ ui.confirmState.opts.confirmText || "确定" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
